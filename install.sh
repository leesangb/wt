#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Installation paths
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="wt"
BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
SHELL_DIR="${HOME}/.wt/shell"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse command line arguments
FORCE_INSTALL=0
for arg in "$@"; do
  case $arg in
    --force|-f)
      FORCE_INSTALL=1
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $arg${NC}"
      echo -e "Usage: $0 [--force|-f]"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}=== wt Installation Script ===${NC}\n"

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
  echo -e "${RED}Error: Bun is not installed${NC}"
  echo -e "${YELLOW}Install Bun from: https://bun.sh${NC}"
  exit 1
fi

# Build the binary if it doesn't exist or if force installing
if [ ! -f "${SCRIPT_DIR}/wt" ] || [ $FORCE_INSTALL -eq 1 ]; then
  echo -e "${BLUE}Installing dependencies...${NC}"
  cd "$SCRIPT_DIR"
  bun install
  
  echo -e "${BLUE}Building binary...${NC}"
  bun run build
  echo -e "${GREEN}✓ Build complete${NC}\n"
fi

# Check if already installed
if [ -f "$BINARY_PATH" ] && [ $FORCE_INSTALL -eq 0 ]; then
  echo -e "${YELLOW}wt is already installed at ${BINARY_PATH}${NC}"
  echo -e "${YELLOW}To update/reinstall, run: ${GREEN}./install.sh --force${NC}"
  exit 0
fi

if [ $FORCE_INSTALL -eq 1 ]; then
  echo -e "${YELLOW}Force install mode: Updating existing installation${NC}\n"
fi

# Create install directory if it doesn't exist
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Creating ${INSTALL_DIR}...${NC}"
  mkdir -p "$INSTALL_DIR"
fi

# Create shell script directory
echo -e "${BLUE}Creating shell script directory at ${SHELL_DIR}...${NC}"
mkdir -p "$SHELL_DIR"

# Copy shell wrapper scripts
echo -e "${BLUE}Copying shell wrapper scripts...${NC}"
for shell_file in "${SCRIPT_DIR}/shell/"*.{zsh,bash,fish}; do
  if [ -f "$shell_file" ]; then
    # Replace /path/to/wt with actual binary path and copy
    filename=$(basename "$shell_file")
    sed "s|/path/to/wt|${BINARY_PATH}|g" "$shell_file" > "${SHELL_DIR}/${filename}"
    echo -e "${GREEN}✓ Copied ${filename}${NC}"
  fi
done

# Install binary
echo -e "${BLUE}Installing wt binary to ${BINARY_PATH}...${NC}"
cp "${SCRIPT_DIR}/wt" "$BINARY_PATH"
chmod +x "$BINARY_PATH"
echo -e "${GREEN}✓ Binary installed${NC}\n"

# Check if INSTALL_DIR is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  echo -e "${YELLOW}Warning: ${INSTALL_DIR} is not in your PATH${NC}"
  echo -e "${YELLOW}Add this to your shell config file:${NC}"
  echo -e "${YELLOW}  export PATH=\"\$PATH:${INSTALL_DIR}\"${NC}\n"
fi

# Function to add source line to shell config
add_source_to_config() {
  local shell_type=$1
  local config_file=$2
  local wrapper_path=$3
  
  if [ ! -f "$config_file" ]; then
    echo -e "${YELLOW}Creating ${config_file}...${NC}"
    touch "$config_file"
  fi
  
  local source_line="source ${wrapper_path}"
  
  # Check if source line already exists
  if grep -q "source.*wt/shell/wt\.${shell_type}" "$config_file" && [ $FORCE_INSTALL -eq 0 ]; then
    echo -e "${YELLOW}✓ ${shell_type} wrapper already configured in ${config_file}${NC}"
    return
  fi
  
  # Remove existing source line if force installing
  if [ $FORCE_INSTALL -eq 1 ] && grep -q "source.*wt/shell/wt\.${shell_type}" "$config_file"; then
    echo -e "${YELLOW}Removing existing ${shell_type} wrapper configuration...${NC}"
    grep -v "source.*wt/shell/wt\.${shell_type}" "$config_file" > "${config_file}.tmp"
    mv "${config_file}.tmp" "$config_file"
  fi
  
  echo -e "${BLUE}Adding ${shell_type} wrapper to ${config_file}...${NC}"
  
  # Add newline and source line
  echo "" >> "$config_file"
  echo "$source_line" >> "$config_file"
  
  echo -e "${GREEN}✓ ${shell_type} wrapper configured${NC}"
}

# Detect shells and add source lines
echo ""
SHELLS_CONFIGURED=0

# Check for zsh
if [ -n "$ZSH_VERSION" ] || [ -f "${HOME}/.zshrc" ]; then
  if [ -f "${SHELL_DIR}/wt.zsh" ]; then
    add_source_to_config "zsh" "${HOME}/.zshrc" "${SHELL_DIR}/wt.zsh"
    SHELLS_CONFIGURED=1
  fi
fi

# Check for bash
if [ -f "${HOME}/.bashrc" ]; then
  if [ -f "${SHELL_DIR}/wt.bash" ]; then
    add_source_to_config "bash" "${HOME}/.bashrc" "${SHELL_DIR}/wt.bash"
    SHELLS_CONFIGURED=1
  fi
fi

# Check for fish
if [ -d "${HOME}/.config/fish" ]; then
  FISH_CONFIG="${HOME}/.config/fish/config.fish"
  if [ -f "${SHELL_DIR}/wt.fish" ]; then
    add_source_to_config "fish" "$FISH_CONFIG" "${SHELL_DIR}/wt.fish"
    SHELLS_CONFIGURED=1
  fi
fi

# Final instructions
echo ""
echo -e "${GREEN}=== Installation Complete! ===${NC}\n"

if [ $SHELLS_CONFIGURED -eq 1 ]; then
  echo -e "${YELLOW}⚠️  Important: Restart your shell or run:${NC}"
  [ -f "${HOME}/.zshrc" ] && echo -e "${BLUE}  source ~/.zshrc${NC}"
  [ -f "${HOME}/.bashrc" ] && echo -e "${BLUE}  source ~/.bashrc${NC}"
  [ -f "${HOME}/.config/fish/config.fish" ] && echo -e "${BLUE}  source ~/.config/fish/config.fish${NC}"
  echo ""
fi

echo -e "${BLUE}To get started:${NC}"
echo -e "  1. ${GREEN}cd${NC} into a git repository"
echo -e "  2. Run ${GREEN}wt init${NC} to initialize configuration"
echo -e "  3. Run ${GREEN}wt new <branch-name>${NC} to create a worktree"
echo ""
echo -e "${BLUE}For more information, visit:${NC}"
echo -e "  https://github.com/leesangb/wt"
echo ""
