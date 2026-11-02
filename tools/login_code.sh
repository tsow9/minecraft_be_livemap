#!/bin/bash
# The sign-in code for the setup page: on the "login-code" branch (see info_branch.sh), and through the site
# (setup_status.sh), which the page can follow without GitHub's limit. login_code.sh put JSON / login_code.sh clear
case "${1:-}" in
  put)
    bash "$(dirname "$0")/setup_status.sh" "$2"
    exec bash "$(dirname "$0")/info_branch.sh" put login-code code.json "$2" ;;
  clear) exec bash "$(dirname "$0")/info_branch.sh" clear login-code ;;
esac
