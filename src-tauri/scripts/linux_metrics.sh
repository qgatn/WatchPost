#!/bin/bash
# WatchPost — Ubuntu/Linux metrics (single SSH exec). Prints one JSON line to stdout.
set -e

json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

hostname=$(hostname -s 2>/dev/null || hostname)
os=$(uname -srm)
uptime_secs=$(awk '{print int($1)}' /proc/uptime)
users=$(who 2>/dev/null | grep -c . || true)
users=${users:-0}
cores=$(nproc 2>/dev/null || echo 1)

mem_total=$(awk '/MemTotal:/ {print $2*1024}' /proc/meminfo)
mem_avail=$(awk '/MemAvailable:/ {print $2*1024}' /proc/meminfo)
swap_total=$(awk '/SwapTotal:/ {print $2*1024}' /proc/meminfo)
swap_free=$(awk '/SwapFree:/ {print $2*1024}' /proc/meminfo)
mem_used=$((mem_total - mem_avail))
swap_used=$((swap_total - swap_free))

read_cpu_global() {
  awk '/^cpu / {idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print idle, total}' /proc/stat
}

read_cpu_cores() {
  awk '/^cpu[0-9]+/ {idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print idle, total}' /proc/stat
}

read_net() {
  awk 'NR>2 {rx+=$2; tx+=$10} END {print rx+0, tx+0}' /proc/net/dev
}

g1=$(read_cpu_global)
c1=$(read_cpu_cores)
n1=$(read_net)
sleep 1
g2=$(read_cpu_global)
c2=$(read_cpu_cores)
n2=$(read_net)

read gi1 gt1 <<< "$g1"
read gi2 gt2 <<< "$g2"
cpu_usage=$(awk -v i1="$gi1" -v t1="$gt1" -v i2="$gi2" -v t2="$gt2" 'BEGIN {
  dt=t2-t1; di=i2-i1; if (dt>0) printf "%.2f", 100*(1-(di/dt)); else print "0"
}')

per_core=""
idx=0
while IFS= read -r line1; do
  line2=$(echo "$c2" | sed -n "$((idx+1))p")
  read ci1 ct1 <<< "$line1"
  read ci2 ct2 <<< "$line2"
  pct=$(awk -v i1="$ci1" -v t1="$ct1" -v i2="$ci2" -v t2="$ct2" 'BEGIN {
    dt=t2-t1; di=i2-i1; if (dt>0) printf "%.2f", 100*(1-(di/dt)); else print "0"
  }')
  if [ -n "$per_core" ]; then per_core="$per_core,"; fi
  per_core="$per_core$pct"
  idx=$((idx+1))
done <<< "$c1"

read nr1 nt1 <<< "$n1"
read nr2 nt2 <<< "$n2"
net_rx_bps=$((nr2 - nr1))
net_tx_bps=$((nt2 - nt1))
if [ "$net_rx_bps" -lt 0 ]; then net_rx_bps=0; fi
if [ "$net_tx_bps" -lt 0 ]; then net_tx_bps=0; fi

disks="["
first=1
disk_count=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  name=$(echo "$line" | awk '{print $1}')
  fstype=$(echo "$line" | awk '{print $2}')
  total=$(echo "$line" | awk '{print $3}')
  avail=$(echo "$line" | awk '{print $5}')
  mount=$(echo "$line" | awk '{
    for (i=7; i<=NF; i++) { if (i>7) printf " "; printf "%s", $i }
  }')
  case "$fstype" in tmpfs|devtmpfs|proc|sysfs|efivarfs|cgroup2|cgroup) continue ;; esac
  case "$mount" in
    /etc/hosts|/etc/hostname|/etc/resolv.conf|/proc/*|/sys/*|/dev/*) continue ;;
  esac
  if ! [[ "$total" =~ ^[0-9]+$ ]] || ! [[ "$avail" =~ ^[0-9]+$ ]]; then continue; fi
  if [ "$total" -lt 1 ]; then continue; fi
  disk_count=$((disk_count + 1))
  [ "$disk_count" -gt 16 ] && break
  if [ "$first" -eq 1 ]; then first=0; else disks="$disks,"; fi
  disks="${disks}{\"name\":\"$(json_str "$name")\",\"mount\":\"$(json_str "$mount")\",\"total\":${total},\"available\":${avail}}"
done < <(df -B1 -PT 2>/dev/null | tail -n +2 | sort -k3 -nr)
disks="${disks}]"

# Print JSON — use plain '%s' for $disks so any '%' in paths cannot break printf.
printf '{"hostname":"%s","os":"%s","cpu_usage":%s,"per_core":[%s],"cpu_cores":%s,"physical_cores":%s,"mem_used":%s,"mem_total":%s,"swap_used":%s,"swap_total":%s,"net_rx_bps":%s,"net_tx_bps":%s,"disks":' \
  "$(json_str "$hostname")" "$(json_str "$os")" "$cpu_usage" "$per_core" "$cores" "$cores" \
  "$mem_used" "$mem_total" "$swap_used" "$swap_total" "$net_rx_bps" "$net_tx_bps"
printf '%s' "$disks"
printf ',"uptime_secs":%s,"active_users":%s}\n' "$uptime_secs" "$users"
