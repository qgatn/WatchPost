#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-watchpost-m4-test}"
PORT="${PORT:-2222}"
HOST="${HOST:-127.0.0.1}"
USER_NAME="${USER_NAME:-devuser}"
KEEP_CONTAINER="${KEEP_CONTAINER:-0}"

TMP_DIR="$(mktemp -d)"
KEY_PATH="${TMP_DIR}/watchpost_m4_ed25519"

cleanup() {
  rm -rf "${TMP_DIR}" || true
  if [[ "${KEEP_CONTAINER}" != "1" ]]; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Preparing docker SSH test target: ${CONTAINER_NAME}"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER_NAME}" -p "${PORT}:22" ubuntu:latest sleep infinity >/dev/null

docker exec "${CONTAINER_NAME}" bash -lc "apt-get update && apt-get install -y openssh-server procps >/dev/null"
docker exec "${CONTAINER_NAME}" bash -lc "mkdir -p /run/sshd && ssh-keygen -A"
docker exec "${CONTAINER_NAME}" bash -lc "id -u ${USER_NAME} >/dev/null 2>&1 || useradd -m -s /bin/bash ${USER_NAME}"
docker exec "${CONTAINER_NAME}" bash -lc "mkdir -p /home/${USER_NAME}/.ssh && chmod 700 /home/${USER_NAME}/.ssh && chown -R ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.ssh"
docker exec "${CONTAINER_NAME}" bash -lc "/usr/sbin/sshd"

ssh-keygen -t ed25519 -N "" -f "${KEY_PATH}" >/dev/null
docker cp "${KEY_PATH}.pub" "${CONTAINER_NAME}:/tmp/watchpost_m4.pub"
docker exec "${CONTAINER_NAME}" bash -lc "cat /tmp/watchpost_m4.pub >> /home/${USER_NAME}/.ssh/authorized_keys && chown ${USER_NAME}:${USER_NAME} /home/${USER_NAME}/.ssh/authorized_keys && chmod 600 /home/${USER_NAME}/.ssh/authorized_keys"

echo "Running SSH command smoke test"
SSH_RESULT="$(
  ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -i "${KEY_PATH}" \
    -p "${PORT}" \
    "${USER_NAME}@${HOST}" \
    "echo watchpost-m4-ok"
)"

if [[ "${SSH_RESULT}" != "watchpost-m4-ok" ]]; then
  echo "Unexpected SSH output: ${SSH_RESULT}"
  exit 1
fi

echo "PASS: docker target reachable with key auth"
echo "Expected WatchPost command shape:"
echo "  ssh -p ${PORT} -i \"${KEY_PATH}\" ${USER_NAME}@${HOST}"
