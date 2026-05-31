# dev-tunnel.ps1 — keep the dev SSH tunnel to the VPS Postgres alive (auto-reconnecting).
#
# Forwards localhost:15432 -> (VPS) localhost:5432, so DATABASE_URL can point at
# localhost:15432/veille_dev. Keepalives stop the VPS from resetting an idle tunnel;
# the loop relaunches ssh if the connection drops anyway (sleep/wake, network change).
#
# Usage (standalone, no Claude session):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-tunnel.ps1
# Stop with Ctrl+C.

$ErrorActionPreference = 'Continue'
$LocalPort  = 15432
$RemoteHost = 'root@178.104.52.131'
$Forward    = '{0}:localhost:5432' -f $LocalPort

Write-Host "[dev-tunnel] maintaining localhost:$LocalPort -> $RemoteHost (Postgres). Ctrl+C to stop."
while ($true) {
  # -N: no remote command (forward only). Keepalive every 60s, give up after 3 misses.
  # ExitOnForwardFailure: bail immediately if the local port can't bind, so we don't
  # silently run a tunnel that forwards nothing.
  ssh -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -N -L $Forward $RemoteHost
  $code = $LASTEXITCODE
  Write-Host "[dev-tunnel] ssh exited (code $code) at $(Get-Date -Format s); reconnecting in 3s..."
  Start-Sleep -Seconds 3
}
