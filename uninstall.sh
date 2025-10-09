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

echo -e "${BLUE}=== wt Uninstallation Script ===${NC}\n"

# Remove shell directory
if [ -d "$SHELL_DIR" ]; then
  echo -e "${BLUE}Removing shell scripts from ${SHELL_DIR}...${NC}"
  rm -rf "$SHELL_DIR"
  echo -e "${GREEN}✓ Shell scripts removed${NC}\n"
else
  echo -e "${YELLOW}Shell directory not found at ${SHELL_DIR}${NC}\n"
fi

# Remove binary
if [ -f "$BINARY_PATH" ]; then
  echo -e "${BLUE}Removing binary from ${BINARY_PATH}...${NC}"
  rm "$BINARY_PATH"
  echo -e "${GREEN}✓ Binary removed${NC}\n"
else
  echo -e "${YELLOW}Binary not found at ${BINARY_PATH}${NC}\n"
fi

# Function to remove source line from shell config
remove_source_from_config() {
  local shell_type=$1
  local config_file=$2
  
  if [ ! -f "$config_file" ]; then
    echo -e "${YELLOW}✓ ${config_file} not found, skipping${NC}"
    return
  fi
  
  # Check if source line exists
  if ! grep -q "source.*\.wt/shell/wt\.${shell_type}" "$config_file"; then
    echo -e "${YELLOW}✓ ${shell_type} wrapper not found in ${config_file}${NC}"
    return
  fi
  
  echo -e "${BLUE}Removing ${shell_type} wrapper from ${config_file}...${NC}"
  
  # Create a backup
  cp "$config_file" "${config_file}.bak"
  
  # Remove the source line
  grep -v "source.*\.wt/shell/wt\.${shell_type}" "${config_file}.bak" > "$config_file"
  
  # Remove the backup if successful
  rm "${config_file}.bak"
  
  echo -e "${GREEN}✓ ${shell_type} wrapper removed${NC}"
}

# Remove wrappers from shells
echo ""
SHELLS_UPDATED=0

# Check for zsh
if [ -f "${HOME}/.zshrc" ]; then
  remove_source_from_config "zsh" "${HOME}/.zshrc"
  SHELLS_UPDATED=1
fi

# Check for bash
if [ -f "${HOME}/.bashrc" ]; then
  remove_source_from_config "bash" "${HOME}/.bashrc"
  SHELLS_UPDATED=1
fi

# Check for fish
if [ -f "${HOME}/.config/fish/config.fish" ]; then
  remove_source_from_config "fish" "${HOME}/.config/fish/config.fish"
  SHELLS_UPDATED=1
fi

# Final message
echo ""
echo -e "${GREEN}=== Uninstallation Complete! ===${NC}\n"

if [ $SHELLS_UPDATED -eq 1 ]; then
  echo -e "${YELLOW}⚠️  Important: Restart your shell or run:${NC}"
  [ -f "${HOME}/.zshrc" ] && echo -e "${BLUE}  source ~/.zshrc${NC}"
  [ -f "${HOME}/.bashrc" ] && echo -e "${BLUE}  source ~/.bashrc${NC}"
  [ -f "${HOME}/.config/fish/config.fish" ] && echo -e "${BLUE}  source ~/.config/fish/config.fish${NC}"
  echo ""
fi

echo -e "${BLUE}Note: This script does not remove:${NC}"
echo -e "  - Worktrees created by wt (usually in ~/.wt/)"
echo -e "  - Repository .wt/settings.json files"
echo ""
echo -e "${YELLOW}To completely remove all traces, manually delete:${NC}"
echo -e "  - ${GREEN}rm -rf ~/.wt/${NC} (your worktrees)"
echo -e "  - Remove ${GREEN}.wt/${NC} directories from your repositories"
echo ""
