// ---------------------------------------------------------------------------
// af completion — generate shell completion scripts for bash/zsh/fish.
// TASK-13. Script is written to stdout only; file redirection is the user's
// responsibility. Usage text goes to stderr to keep stdout parseable.
// See L2 note: prefer `>>` (append) over `>` to avoid clobbering ~/.zshrc.
// ---------------------------------------------------------------------------

import { ValidationError } from "@core/errors/index.ts";
import type { LoggerPort } from "@core/ports/logger-port.ts";
import { defineCommand } from "citty";
import { handleCliError } from "../app.ts";

export type SupportedShell = "bash" | "zsh" | "fish";

export interface CompletionCommandComponents {
  logger: LoggerPort;
}

export interface CliWriter {
  write(chunk: string): boolean;
}

export interface CompletionCommandOptions {
  stdout?: CliWriter;
  stderr?: CliWriter;
}

export const USAGE_MESSAGE = `Usage: af completion <bash|zsh|fish>

Install (recommended append):
  Bash:  af completion bash >> ~/.bashrc
  Zsh:   af completion zsh >> ~/.zshrc
  Fish:  af completion fish > ~/.config/fish/completions/af.fish
`;

const BASH_SCRIPT = `# af completion for bash
_af_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="auth add ls do cache task project cal block setup completion --mcp --help --version"

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "$prev" in
    auth)
      COMPREPLY=( $(compgen -W "status logout refresh --manual" -- "$cur") )
      return 0
      ;;
    task)
      COMPREPLY=( $(compgen -W "edit move plan snooze delete" -- "$cur") )
      return 0
      ;;
    project)
      COMPREPLY=( $(compgen -W "ls add delete" -- "$cur") )
      return 0
      ;;
    cache)
      COMPREPLY=( $(compgen -W "clear" -- "$cur") )
      return 0
      ;;
    setup)
      COMPREPLY=( $(compgen -W "claude-code cursor claude-desktop" -- "$cur") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      return 0
      ;;
    add|ls)
      COMPREPLY=( $(compgen -W "--today --tomorrow --date --at --duration --project --json --inbox --done --search" -- "$cur") )
      return 0
      ;;
  esac
}

complete -F _af_completion af
`;

const ZSH_SCRIPT = `#compdef af
_af() {
  local -a commands
  commands=(
    'auth:Manage Akiflow authentication'
    'add:Create a task'
    'ls:List tasks'
    'do:Complete tasks'
    'cache:Manage the local sync cache'
    'task:Task operations (edit/move/plan/snooze/delete)'
    'project:Project management (ls/add/delete)'
    'cal:Calendar commands'
    'block:Time block commands'
    'setup:Register MCP server in AI editor configs'
    'completion:Generate shell completion script'
  )

  _arguments -C \\
    '1:command:->command' \\
    '*::args:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[1] in
        auth)
          _values 'auth subcommand' 'status' 'logout' 'refresh'
          ;;
        task)
          _values 'task subcommand' 'edit' 'move' 'plan' 'snooze' 'delete'
          ;;
        project)
          _values 'project subcommand' 'ls' 'add' 'delete'
          ;;
        cache)
          _values 'cache subcommand' 'clear'
          ;;
        setup)
          _values 'setup target' 'claude-code' 'cursor' 'claude-desktop'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
      esac
      ;;
  esac
}

compdef _af af
`;

const FISH_SCRIPT = `# af completion for fish
complete -c af -f

complete -c af -n "__fish_use_subcommand" -a "auth" -d "Manage Akiflow authentication"
complete -c af -n "__fish_use_subcommand" -a "add" -d "Create a task"
complete -c af -n "__fish_use_subcommand" -a "ls" -d "List tasks"
complete -c af -n "__fish_use_subcommand" -a "do" -d "Complete tasks"
complete -c af -n "__fish_use_subcommand" -a "cache" -d "Manage the local sync cache"
complete -c af -n "__fish_use_subcommand" -a "task" -d "Task operations"
complete -c af -n "__fish_use_subcommand" -a "project" -d "Project management"
complete -c af -n "__fish_use_subcommand" -a "cal" -d "Calendar commands"
complete -c af -n "__fish_use_subcommand" -a "block" -d "Time block commands"
complete -c af -n "__fish_use_subcommand" -a "setup" -d "Register MCP server"
complete -c af -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion"

complete -c af -n "__fish_seen_subcommand_from auth" -a "status logout refresh"
complete -c af -n "__fish_seen_subcommand_from task" -a "edit move plan snooze delete"
complete -c af -n "__fish_seen_subcommand_from project" -a "ls add delete"
complete -c af -n "__fish_seen_subcommand_from cache" -a "clear"
complete -c af -n "__fish_seen_subcommand_from setup" -a "claude-code cursor claude-desktop"
complete -c af -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"
`;

export function generateCompletionScript(shell: string): string {
  switch (shell) {
    case "bash":
      return BASH_SCRIPT;
    case "zsh":
      return ZSH_SCRIPT;
    case "fish":
      return FISH_SCRIPT;
    default:
      throw new ValidationError(`Unknown shell: '${shell}'. Supported shells: bash, zsh, fish.`, "shell");
  }
}

export function createCompletionCommand(
  components: CompletionCommandComponents,
  options: CompletionCommandOptions = {},
) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  return defineCommand({
    meta: {
      name: "completion",
      description: "Generate shell completion script (bash/zsh/fish) to stdout",
    },
    args: {
      shell: {
        type: "positional",
        required: false,
        description: "Target shell: bash, zsh, or fish",
      },
    },
    async run({ args }) {
      try {
        const shell = typeof args.shell === "string" ? args.shell : undefined;
        if (!shell) {
          stderr.write(USAGE_MESSAGE);
          throw new ValidationError("Shell argument is required", "shell");
        }
        const script = generateCompletionScript(shell);
        stdout.write(script);
      } catch (err) {
        handleCliError(err, components.logger);
      }
    },
  });
}
