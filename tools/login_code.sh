#!/bin/bash
# The sign-in code for the setup page (see info_branch.sh): login_code.sh put JSON / login_code.sh clear
case "${1:-}" in
  put) exec bash "$(dirname "$0")/info_branch.sh" put login-code code.json "$2" ;;
  clear) exec bash "$(dirname "$0")/info_branch.sh" clear login-code ;;
esac
