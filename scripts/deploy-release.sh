#!/usr/bin/env bash
# 在腾讯云服务器上构建、切换并验证指定 release；失败时恢复旧版本。
set -Eeuo pipefail

readonly DEPLOY_ROOT="${1:?deployment root is required}"
readonly RELEASE="${2:?release SHA is required}"
readonly RELEASES_DIR="$DEPLOY_ROOT/releases"
readonly RELEASE_DIR="$RELEASES_DIR/$RELEASE"
readonly CURRENT_LINK="$DEPLOY_ROOT/current"
readonly TRENDING_DATA_DIR="$DEPLOY_ROOT/data/github-trending"
readonly PROJECT_NAME="lingerzen"

if [[ ! "$RELEASE" =~ ^[0-9a-f]{40}$ ]]; then
	echo "Release must be a full lowercase SHA-1" >&2
	exit 1
fi

readonly COMPOSE=(docker compose --project-directory "$RELEASE_DIR" -p "$PROJECT_NAME")

if [[ ! -r "$DEPLOY_ROOT/.env" || ! -d "$RELEASE_DIR" ]]; then
	echo "Production environment or release directory is unavailable" >&2
	exit 1
fi

mkdir -p -- "$TRENDING_DATA_DIR"
chmod 750 -- "$DEPLOY_ROOT/data" "$TRENDING_DATA_DIR"

previous_release=""
if [[ -L "$CURRENT_LINK" ]]; then
	previous_release="$(readlink -f "$CURRENT_LINK")"
	if [[ "$previous_release" != "$RELEASES_DIR/"* || ! -d "$previous_release" ]]; then
		echo "Current release link is invalid" >&2
		exit 1
	fi
elif [[ -e "$CURRENT_LINK" ]]; then
	echo "Current release path is not a symbolic link" >&2
	exit 1
fi

export DOCKER_BUILDKIT=1
export IMAGE_TAG="$RELEASE"
export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

switched=false
rollback() {
	local exit_code=$?
	trap - ERR

	if [[ "$switched" == true ]]; then
		if [[ -n "$previous_release" ]]; then
			echo "Deployment failed; restoring the previous release" >&2
			rm -f -- "$CURRENT_LINK.next"
			ln -s -- "$previous_release" "$CURRENT_LINK.next"
			mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
			IMAGE_TAG="$(basename "$previous_release")" docker compose \
				--project-directory "$previous_release" \
				-p "$PROJECT_NAME" \
				up -d --remove-orphans || true
		else
			"${COMPOSE[@]}" down --remove-orphans || true
			rm -f -- "$CURRENT_LINK"
		fi
	fi

	exit "$exit_code"
}
trap rollback ERR

# 构建成功前不触碰 current，确保失败版本不会成为活动版本。
"${COMPOSE[@]}" build

rm -f -- "$CURRENT_LINK.next"
ln -s -- "$RELEASE_DIR" "$CURRENT_LINK.next"
mv -Tf -- "$CURRENT_LINK.next" "$CURRENT_LINK"
switched=true

"${COMPOSE[@]}" up -d --remove-orphans

container_id="$("${COMPOSE[@]}" ps -q firefly)"
test -n "$container_id"

healthy=false
for _ in $(seq 1 18); do
	status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
	case "$status" in
		healthy)
			healthy=true
			break
			;;
		unhealthy)
			"${COMPOSE[@]}" logs --tail=100 firefly >&2
			false
			;;
	esac
	sleep 5
done

if [[ "$healthy" != true ]]; then
	"${COMPOSE[@]}" logs --tail=100 firefly >&2
	echo "Firefly container did not become healthy" >&2
	false
fi

"${COMPOSE[@]}" ps
trap - ERR

# 保留当前版本和上一版本，删除更早的 release 以限制磁盘增长。
mapfile -t releases < <(ls -1dt "$RELEASES_DIR"/* 2>/dev/null || true)
for candidate in "${releases[@]:3}"; do
	[[ -d "$candidate" ]] || continue
	rm -rf -- "$candidate"
done

docker image prune -f --filter "label=com.docker.compose.project=$PROJECT_NAME"
echo "Deployment completed for $RELEASE"
