#!/bin/sh
# shellcheck disable=SC1007,SC2016
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
DEFAULT_IMAGE="goldband-sandbox:local"

usage() {
    cat <<'EOF'
Usage:
  sandbox/sandbox.sh build [--image NAME]
  sandbox/sandbox.sh run <project-dir> [options] [-- command]

Options:
  --image NAME          Container image name. Default: goldband-sandbox:local
  --rebuild            Build the image before running it.
  --env-file FILE      Pass an explicit env file into the container.
  --env KEY=VALUE      Pass one explicit environment variable.
  --cache-volume NAME  Mount a named cache volume at /home/goldband/.cache.
  -h, --help           Show this help.

Mount contract:
  - goldband is baked into the image at read-only /opt/goldband.
  - project-dir is mounted read-write at /workspace/project.
  - HOME stays inside the container at /home/goldband.
  - Host HOME, ~/.ssh, cloud credentials, and Docker sockets are not mounted.
EOF
}

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

quote_arg() {
    if [ "$1" = "" ]; then
        printf "''"
        return
    fi
    printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

runtime() {
    if [ "${GOLDBAND_SANDBOX_NO_RUNTIME:-0}" = "1" ]; then
        return 1
    fi
    if [ -n "${GOLDBAND_SANDBOX_RUNTIME:-}" ]; then
        command -v "$GOLDBAND_SANDBOX_RUNTIME" >/dev/null 2>&1 || return 1
        printf '%s\n' "$GOLDBAND_SANDBOX_RUNTIME"
        return 0
    fi
    if command -v docker >/dev/null 2>&1; then
        printf '%s\n' docker
        return 0
    fi
    if command -v podman >/dev/null 2>&1; then
        printf '%s\n' podman
        return 0
    fi
    return 1
}

require_runtime() {
    runtime || fail "No container runtime found. Install Docker Desktop or Podman, then retry."
}

build_image() {
    image="$1"
    rt=$(require_runtime)
    "$rt" build \
        -f "$ROOT_DIR/sandbox/devcontainer/Dockerfile" \
        -t "$image" \
        "$ROOT_DIR"
}

init_run_defaults() {
    PROJECT_DIR="$1"
    [ -d "$PROJECT_DIR" ] || fail "Project directory does not exist: $PROJECT_DIR"
    PROJECT_DIR=$(CDPATH= cd -- "$PROJECT_DIR" && pwd -P)
    IMAGE="$DEFAULT_IMAGE"
    REBUILD=0
    ENV_FILE=""
    CACHE_VOLUME=""
    ENV_ARGS=""
    CONTAINER_COMMAND='exec "${SHELL:-/bin/bash}"'
}

set_container_command() {
    [ "$#" -gt 0 ] || fail "Missing command after --"
    CONTAINER_COMMAND=""
    while [ "$#" -gt 0 ]; do
        quoted_arg=$(quote_arg "$1")
        CONTAINER_COMMAND="${CONTAINER_COMMAND}${CONTAINER_COMMAND:+ }$quoted_arg"
        shift
    done
}

parse_run_options() {
    init_run_defaults "$1"
    shift
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --image)
                [ "$#" -ge 2 ] || fail "Missing value for --image"
                IMAGE="$2"
                shift 2
                ;;
            --rebuild)
                REBUILD=1
                shift
                ;;
            --env-file)
                [ "$#" -ge 2 ] || fail "Missing value for --env-file"
                [ -f "$2" ] || fail "Env file does not exist: $2"
                ENV_FILE=$(CDPATH= cd -- "$(dirname -- "$2")" && pwd -P)/$(basename -- "$2")
                shift 2
                ;;
            --env)
                [ "$#" -ge 2 ] || fail "Missing value for --env"
                case "$2" in
                    *=*) ENV_ARGS="${ENV_ARGS}
$2" ;;
                    *) fail "--env requires KEY=VALUE" ;;
                esac
                shift 2
                ;;
            --cache-volume)
                [ "$#" -ge 2 ] || fail "Missing value for --cache-volume"
                CACHE_VOLUME="$2"
                shift 2
                ;;
            --)
                shift
                set_container_command "$@"
                break
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                fail "Unknown option: $1"
                ;;
        esac
    done
}

run_container() {
    rt=$(require_runtime)
    if [ "$REBUILD" -eq 1 ] || ! "$rt" image inspect "$IMAGE" >/dev/null 2>&1; then
        build_image "$IMAGE"
    fi
    set -- "$rt" run --rm \
        --workdir /workspace/project \
        -e GOLDBAND_CONTAINER=1 \
        -e GOLDBAND_SKIP_BUILD=1 \
        -e GOLDBAND_SKIP_COREUTILS=1 \
        -e GOLDBAND_SKIP_GENERATE=1 \
        -e GOLDBAND_SKIP_PLAYWRIGHT=1 \
        -v "$PROJECT_DIR:/workspace/project:rw"

    if [ -t 0 ] && [ -t 1 ]; then
        set -- "$@" -it
    fi
    if [ -n "$ENV_FILE" ]; then
        set -- "$@" --env-file "$ENV_FILE"
    fi
    if [ -n "$CACHE_VOLUME" ]; then
        set -- "$@" -v "$CACHE_VOLUME:/home/goldband/.cache:rw"
    fi
    if [ -n "$ENV_ARGS" ]; then
        while IFS= read -r env_entry; do
            [ -n "$env_entry" ] || continue
            set -- "$@" -e "$env_entry"
        done <<EOF_ENV
$ENV_ARGS
EOF_ENV
    fi

    set -- "$@" "$IMAGE" /bin/sh -lc "cd /workspace/project && $CONTAINER_COMMAND"
    "$@"
}

run_project() {
    parse_run_options "$@"
    run_container
}

main() {
    command_name="${1:-}"
    case "$command_name" in
        build)
            shift
            image="$DEFAULT_IMAGE"
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --image)
                        [ "$#" -ge 2 ] || fail "Missing value for --image"
                        image="$2"
                        shift 2
                        ;;
                    -h|--help)
                        usage
                        exit 0
                        ;;
                    *)
                        fail "Unknown option: $1"
                        ;;
                esac
            done
            build_image "$image"
            ;;
        run)
            shift
            [ "$#" -ge 1 ] || fail "Missing project directory"
            project_dir="$1"
            shift
            run_project "$project_dir" "$@"
            ;;
        -h|--help|help)
            usage
            ;;
        *)
            usage >&2
            exit 1
            ;;
    esac
}

main "$@"
