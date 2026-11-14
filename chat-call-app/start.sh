
#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${PORT:-3000}"
APP_NAME="Chat Call App"

# -------------------------------
# Detect operating system
# -------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "================================"
echo "       ${APP_NAME}"
echo "================================"
echo "OS: $OS"
echo "Architecture: $ARCH"
echo "Port: $PORT"

# -------------------------------
# Root / sudo helper
# -------------------------------
run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  elif command -v su >/dev/null 2>&1; then
    su -c "$(printf '%q ' "$@")"
  else
    echo "Root privileges required to install packages."
    exit 1
  fi
}

# -------------------------------
# Install Node.js and npm
# -------------------------------
install_node() {
  echo "Installing Node.js and npm..."

  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        run_as_root apt-get update
        run_as_root apt-get install -y nodejs npm curl
      elif command -v dnf >/dev/null 2>&1; then
        run_as_root dnf install -y nodejs npm curl
      elif command -v pacman >/dev/null 2>&1; then
        run_as_root pacman -Sy --noconfirm nodejs npm curl
      elif command -v pkg >/dev/null 2>&1; then
        pkg update -y
        pkg install -y nodejs-lts npm curl
      else
        echo "Unsupported Linux package manager."
        echo "Install Node.js manually: https://nodejs.org/"
        exit 1
      fi
      ;;
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is required on macOS."
        echo "Install it from https://brew.sh/"
        exit 1
      fi
      brew install node
      ;;
    *)
      echo "Unsupported OS: $OS"
      exit 1
      ;;
  esac
}

# -------------------------------
# Install cloudflared
# -------------------------------
install_cloudflared() {
  echo "Installing Cloudflare Tunnel..."

  case "$OS" in
    Linux)
      local CF_ARCH

      case "$ARCH" in
        x86_64|amd64) CF_ARCH="amd64" ;;
        aarch64|arm64) CF_ARCH="arm64" ;;
        armv7l) CF_ARCH="arm" ;;
        *)
          echo "Unsupported architecture: $ARCH"
          exit 1
          ;;
      esac

      local DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"

      curl -fsSL "$DOWNLOAD_URL" -o /tmp/cloudflared
      chmod +x /tmp/cloudflared
      run_as_root install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared
      rm -f /tmp/cloudflared
      ;;
    Darwin)
      brew install cloudflared
      ;;
    *)
      echo "Please install cloudflared manually:"
      echo "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      exit 1
      ;;
  esac
}

# -------------------------------
# Dependency checks
# -------------------------------
if ! command -v node >/dev/null 2>&1 || \
   ! command -v npm >/dev/null 2>&1; then
  install_node
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  install_cloudflared
fi

# -------------------------------
# Verify installations
# -------------------------------
echo
echo "Node version:"
node --version

echo "NPM version:"
npm --version

echo "Cloudflared version:"
cloudflared --version

# -------------------------------
# Install project dependencies
# -------------------------------
if [[ ! -f package.json ]]; then
  echo "ERROR: package.json not found!"
  echo "Run this script inside your Chat Call App project directory."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo
  echo "Installing project npm dependencies..."
  npm install
else
  echo "Project dependencies already installed."
fi

# -------------------------------
# Start Node.js server
# -------------------------------
echo
echo "Starting ${APP_NAME} on port ${PORT}..."

PORT="$PORT" npm start &
NODE_PID=$!

cleanup() {
  echo
  echo "Stopping ${APP_NAME}..."

  kill "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# -------------------------------
# Start Cloudflare Tunnel
# -------------------------------
echo
echo "========================================"
echo " Starting Cloudflare Quick Tunnel"
echo "========================================"
echo "Wait for your public HTTPS URL."
echo "Example: https://something.trycloudflare.com"
echo "========================================"
echo

cloudflared tunnel --url "http://127.0.0.1:${PORT}"
