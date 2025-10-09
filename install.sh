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

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}=== wt Installation Script ===${NC}\n"

# Create install directory if it doesn't exist
if [ ! -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Creating ${INSTALL_DIR}...${NC}"
  mkdir -p "$INSTALL_DIR"
fi

# Check if binary exists in current directory
if [ ! -f "${SCRIPT_DIR}/wt" ]; then
  echo -e "${RED}Error: wt binary not found in ${SCRIPT_DIR}${NC}"
  echo -e "${YELLOW}Please build the binary first with: bun run build${NC}"
  exit 1
fi

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

# Function to add wrapper to shell config
add_wrapper_to_config() {
  local shell_type=$1
  local config_file=$2
  local wrapper_file=$3
  
  if [ ! -f "$config_file" ]; then
    echo -e "${YELLOW}Creating ${config_file}...${NC}"
    touch "$config_file"
  fi
  
  # Check if wrapper already exists
  if grep -q "# wt shell wrapper" "$config_file"; then
    echo -e "${YELLOW}✓ ${shell_type} wrapper already exists in ${config_file}${NC}"
    return
  fi
  
  echo -e "${BLUE}Adding ${shell_type} wrapper to ${config_file}...${NC}"
  
  # Add newline before appending
  echo "" >> "$config_file"
  
  # Read and modify the wrapper file
  sed "s|/path/to/wt|${BINARY_PATH}|g" "$wrapper_file" >> "$config_file"
  
  echo -e "${GREEN}✓ ${shell_type} wrapper added${NC}"
}

# Detect shells and add wrappers
echo ""
SHELLS_CONFIGURED=0

# Check for zsh
if [ -n "$ZSH_VERSION" ] || [ -f "${HOME}/.zshrc" ]; then
  if [ -f "${SCRIPT_DIR}/shell/wt.zsh" ]; then
    add_wrapper_to_config "zsh" "${HOME}/.zshrc" "${SCRIPT_DIR}/shell/wt.zsh"
    SHELLS_CONFIGURED=1
  fi
fi

# Check for bash
if [ -f "${HOME}/.bashrc" ]; then
  if [ -f "${SCRIPT_DIR}/shell/wt.bash" ]; then
    add_wrapper_to_config "bash" "${HOME}/.bashrc" "${SCRIPT_DIR}/shell/wt.bash"
    SHELLS_CONFIGURED=1
  fi
fi

# Check for fish
if [ -d "${HOME}/.config/fish" ]; then
  FISH_CONFIG="${HOME}/.config/fish/config.fish"
  if [ -f "${SCRIPT_DIR}/shell/wt.fish" ]; then
    add_wrapper_to_config "fish" "$FISH_CONFIG" "${SCRIPT_DIR}/shell/wt.fish"
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
