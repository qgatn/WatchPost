$ErrorActionPreference = "Stop"

$ContainerName = $env:CONTAINER_NAME
if ([string]::IsNullOrWhiteSpace($ContainerName)) { $ContainerName = "watchpost-m4-test" }
$Port = $env:PORT
if ([string]::IsNullOrWhiteSpace($Port)) { $Port = "2222" }
$HostName = $env:HOST
if ([string]::IsNullOrWhiteSpace($HostName)) { $HostName = "127.0.0.1" }
$UserName = $env:USER_NAME
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = "devuser" }

$TmpDir = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath()) -Name ("watchpost-m4-" + [guid]::NewGuid().ToString()) | Select-Object -ExpandProperty FullName
$KeyPath = Join-Path $TmpDir "watchpost_m4_ed25519"

function Cleanup {
  if (Test-Path $TmpDir) {
    Remove-Item -LiteralPath $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  docker rm -f $ContainerName *> $null
}

try {
  docker rm -f $ContainerName *> $null
  docker run -d --name $ContainerName -p "$Port`:22" ubuntu:latest sleep infinity *> $null

  docker exec $ContainerName bash -lc "apt-get update && apt-get install -y openssh-server procps >/dev/null"
  docker exec $ContainerName bash -lc "mkdir -p /run/sshd && ssh-keygen -A"
  docker exec $ContainerName bash -lc "id -u $UserName >/dev/null 2>&1 || useradd -m -s /bin/bash $UserName"
  docker exec $ContainerName bash -lc "mkdir -p /home/$UserName/.ssh && chmod 700 /home/$UserName/.ssh && chown -R $UserName`:$UserName /home/$UserName/.ssh"
  docker exec $ContainerName bash -lc "/usr/sbin/sshd"

  ssh-keygen -t ed25519 -N "" -f $KeyPath *> $null
  docker cp "$KeyPath.pub" "${ContainerName}:/tmp/watchpost_m4.pub"
  docker exec $ContainerName bash -lc "cat /tmp/watchpost_m4.pub >> /home/$UserName/.ssh/authorized_keys && chown $UserName`:$UserName /home/$UserName/.ssh/authorized_keys && chmod 600 /home/$UserName/.ssh/authorized_keys"

  $result = ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i $KeyPath -p $Port "$UserName@$HostName" "echo watchpost-m4-ok"
  if ($result.Trim() -ne "watchpost-m4-ok") {
    throw "Unexpected SSH output: $result"
  }

  Write-Host "PASS: docker target reachable with key auth"
  Write-Host "Expected WatchPost command shape:"
  Write-Host "  ssh -p $Port -i `"$KeyPath`" $UserName@$HostName"
}
finally {
  Cleanup
}
