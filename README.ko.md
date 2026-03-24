# wt - Git Worktree 매니저

[English](./README.md) | 한국어

pre/post 스크립트 지원이 포함된 git worktree 관리 CLI 도구입니다.

## 기능

- 🚀 브랜치 기반 ID와 저장소 기반 이름으로 worktree 생성
- 🎯 새 worktree로 자동 이동 (shell wrapper 통합)
- ⚙️ 저장소별로 worktree 기본 디렉토리, 기본 브랜치, 원격 푸시 동작 설정
- 🔄 worktree 생성 전 최신 변경사항 자동 fetch
- 📤 기본적으로 원격에 자동 푸시 (`--no-push` 플래그로 비활성화)
- 🎯 환경 변수를 사용한 자동화를 위한 Pre/post 스크립트 실행
- 📦 빠르고 경량화된 Bun 기반 바이너리
- 🎨 더 나은 UX를 위한 컬러 CLI 출력

## 설치

### 소스에서 빌드

```bash
# 저장소 클론
git clone https://github.com/leesangb/wt.git
cd wt

# 설치 스크립트 실행 (빌드 자동 처리)
./install.sh

# 최신 버전으로 업데이트하려면 --force 사용
./install.sh --force
```

설치 스크립트는 다음을 수행합니다:
- Bun 설치 여부 확인
- `bun install` 및 `bun run build` 자동 실행
- `wt` 바이너리를 `~/.local/bin/wt`에 설치
- shell wrapper 스크립트를 `~/.wt/shell/`로 복사
- shell 설정 파일(`.zshrc`, `.bashrc`, 또는 `config.fish`)에 shell wrapper source 라인 자동 추가
- 자동 cd 기능 설정

설치 후 shell을 재시작하거나 다음을 실행하세요:
```bash
source ~/.zshrc  # 또는 ~/.bashrc 또는 ~/.config/fish/config.fish
```

### 수동 Shell 통합 (선택사항)

수동 설정을 선호하거나 설치 스크립트가 자동으로 shell을 구성하지 않은 경우, `~/.wt/shell/`에 설치된 wrapper 스크립트를 수동으로 source할 수 있습니다:

#### Zsh (~/.zshrc)

```bash
source ~/.wt/shell/wt.zsh
```

#### Bash (~/.bashrc)

```bash
source ~/.wt/shell/wt.bash
```

#### Fish (~/.config/fish/config.fish)

```fish
source ~/.wt/shell/wt.fish
```

**참고:** shell wrapper 스크립트는 설치 시 `~/.wt/shell/`에 자동으로 설치됩니다.

### 제거

```bash
# 제거 스크립트 실행
./uninstall.sh

# 다음을 수행합니다:
# - ~/.local/bin/에서 wt 바이너리 제거
# - ~/.wt/shell/에서 shell wrapper 스크립트 제거
# - shell 설정 파일에서 source 라인 제거
```

**참고:** 제거 스크립트는 worktree나 저장소별 `.wt/settings.json` / `.wt/settings.local.json` 파일을 제거하지 않습니다. 완전히 정리하려면 수동으로 실행하세요:
```bash
rm -rf ~/.wt/  # 모든 worktree와 shell 스크립트 제거
```

### Shell 통합 없이 사용

shell wrapper를 설정하지 않은 경우 `--no-cd` 플래그를 사용할 수 있습니다:

```bash
wt new feature-branch --no-cd
wt checkout feature-branch --no-cd
wt pr 123 --no-cd
# 그 다음 수동으로: cd /출력에/표시된/경로
```

## 사용법

**참고:** `wt`는 git 저장소 내부 어느 디렉터리에서나 실행할 수 있습니다. 명령어는 내부적으로 저장소 루트를 기준으로 컨텍스트를 해석하며, `.wt/settings.json`과 `.wt/settings.local.json`의 상대 `worktreeDir` 값도 저장소 루트를 기준으로 해석됩니다.

### 설정 초기화

```bash
wt init
```

저장소에 `.wt/settings.json`을 생성합니다:

```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": [],
    "postMode": "async"
  }
}
```

`wt init`는 local override 파일이 기본적으로 추적되지 않도록 저장소 `.gitignore`에 `.wt/settings.local.json`도 추가합니다.

### 새 worktree 생성

```bash
# 생성 후 자동 이동 (shell wrapper 필요)
wt new feature-branch

# 기본 브랜치 지정
wt new feature-branch --base develop

# 원격 푸시 건너뛰기
wt new feature-branch --no-push

# 자동 cd 없이 직접 바이너리 사용
wt new feature-branch --no-cd
```

다음을 수행합니다:
1. 원격에서 최신 변경사항 가져오기 (`git fetch`)
2. pre 스크립트 실행 (설정된 경우)
3. `~/.wt/<저장소명-feature-branch>`에 `feature-branch` 브랜치로 worktree 생성
4. 새 브랜치를 원격에 upstream 추적과 함께 푸시 (`--no-push`를 사용하지 않는 경우)
5. 새 worktree에서 post 스크립트 실행 (설정된 경우)
6. 새 worktree 디렉토리로 자동 이동 (shell wrapper 사용 시)

post 스크립트를 async 모드로 실행하면 `wt`는 즉시 반환되고, `<worktree>/.wt/` 아래에 상태/로그 파일(`post-task.json`, `post-task.log`)이 생성됩니다. macOS에서는 async 작업이 시작될 때와 끝날 때 알림 센터 알림도 표시되며, 알림 전송 실패는 무시됩니다.

기본적으로 `WT_ID`는 브랜치 이름을 사용합니다. 브랜치에 `/`가 있으면 실제 worktree 디렉토리 이름에서는 `-`로 치환하지만, 저장되는 ID 값은 그대로 유지됩니다. 예를 들어 `feature/issue-12`는 `~/.wt/<저장소명-feature-issue-12>` 경로로 생성됩니다. 이때 같은 sanitize 결과를 가진 다른 worktree ID가 이미 있으면, 경로 충돌을 피하기 위해 짧은 suffix를 자동으로 덧붙입니다.

**옵션:**
- `--base <branch>` - 생성할 기본 브랜치 (기본값: 설정 또는 `main`)
- `--id <id>` - 기본 worktree ID 덮어쓰기 (기본값: 브랜치 이름)
- `--no-push` - 새 브랜치를 원격에 푸시하지 않음
- `--no-cd` - cd 명령 출력 안 함 (shell wrapper 없이 직접 바이너리 사용 시)

### 로컬 브랜치 worktree 생성 또는 이동

```bash
# 기존 로컬 브랜치용 새 worktree를 만들거나, 이미 열려 있는 worktree로 이동
wt checkout feature-branch

# alias
wt switch feature-branch

# 자동 cd 없이 직접 바이너리 사용
wt checkout feature-branch --no-cd
```

이 명령은 다음을 수행합니다:
1. 기존 worktree 중 해당 로컬 브랜치를 이미 체크아웃한 곳이 있는지 확인
2. 있으면 그 worktree로 바로 이동
3. 없으면 기존 로컬 브랜치를 기준으로 새 worktree를 생성

`wt checkout`은 브랜치가 로컬에 이미 존재해야 합니다. 새 브랜치를 먼저 만들고 싶다면 `wt new <branch>`를 사용하면 됩니다.
worktree ID 기본값은 브랜치 이름이며, 같은 ID가 이미 다른 worktree에서 사용 중이면 `wt checkout`이 `-1`, `-2` 같은 suffix를 붙여 고유하게 만들고 그 사실을 CLI 출력으로 알려줍니다.

### Pull request worktree 생성 또는 이동

```bash
# 새 PR worktree를 만들거나, 해당 PR head branch를 이미 체크아웃한 worktree로 이동
wt pr 123

# 자동 cd 없이 직접 바이너리 사용
wt pr 123 --no-cd
```

이 명령은 다음을 수행합니다:
1. GitHub CLI에서 PR의 base branch와 head branch를 조회
2. 기존 worktree 중 그 PR head branch를 이미 체크아웃한 곳이 있는지 확인
3. 있으면 그 worktree로 바로 이동
4. 없으면 `pr-<번호>` 기반 ID/경로로 새 worktree를 만들고 `gh pr checkout`으로 PR 체크아웃

`wt pr`는 `pr-123` 같은 synthetic 로컬 브랜치를 새로 만들지 않고, PR의 실제 head branch 이름을 그대로 사용합니다. 그래서 PR 정보를 먼저 알아야 하므로 GitHub CLI(`gh`)가 항상 필요합니다.
대신 worktree ID와 디렉터리 이름은 PR 번호(`pr-123`)를 기준으로 만들고, 그 ID가 이미 사용 중이면 `-1`, `-2` 같은 suffix를 붙여 고유하게 만들며 그 사실을 CLI 출력으로 알려줍니다.

### wt 업데이트

최신 릴리스로 업데이트 (현재 macOS만 지원):
```bash
wt update
```

현재 버전을 강제로 다시 다운로드:
```bash
wt update --force
```

특정 버전 설치:
```bash
wt update --version 0.1.2
```

quarantine 속성 제거를 건너뛰기:
```bash
wt update --no-remove-quarantine
```

### 모든 worktree 목록 조회

```bash
wt list
# 또는
wt ls
```

### worktree 제거

```bash
wt remove <id...>
# 또는
wt rm <id...>
```

worktree에 수정된 파일이나 push되지 않은 커밋이 남아 있으면, `wt rm`은 삭제 전에 한 번 더 확인합니다. 여러 worktree를 넘기면 각 대상마다 개별로 확인합니다. 프롬프트를 건너뛰려면 `wt rm <id...> --force`를 사용할 수 있습니다.

다음 방법으로 worktree를 제거할 수 있습니다:
- ID (기본값: 브랜치 이름, 예: `feature/issue-12`)
- 레포 prefix가 포함된 전체 ID (예: `myrepo-feature/issue-12`)
- worktree를 고유하게 식별할 수 있는 경로의 일부

## 설정

저장소의 `.wt/settings.json`을 편집하세요:

- **worktreeDir**: worktree의 기본 디렉토리 (기본값: `~/.wt`)
- **baseBranch**: 새 worktree의 기본 브랜치 (기본값: `main`)
- **pushRemote**: 새 브랜치를 원격에 자동 푸시 (기본값: `true`)
- **scripts.pre**: worktree 생성 전에 실행할 명령어 배열 (저장소 루트에서 실행)
- **scripts.post**: worktree 생성 후에 실행할 명령어 배열 (새 worktree 디렉토리에서 실행)
- **scripts.postMode**: `async`(기본값) 또는 `sync`(포그라운드 실행)

사용자별 또는 머신별 override가 필요하면 선택적으로 `.wt/settings.local.json`도 둘 수 있습니다. `wt`는 먼저 `.wt/settings.json`을 읽고, 그 위에 `.wt/settings.local.json`을 덮어씁니다. 중첩된 `scripts.*` 필드도 병합되므로 `scripts` 전체를 다시 쓰지 않고 `scripts.postMode`만 바꿀 수 있습니다.

예시 `.wt/settings.local.json`:

```json
{
  "baseBranch": "develop",
  "scripts": {
    "postMode": "sync"
  }
}
```

### 환경 변수

스크립트는 다음 환경 변수에 접근할 수 있습니다:

- `$WT_PATH` - worktree 디렉토리의 전체 경로
- `$WT_ID` - worktree ID (기본값: 브랜치 이름, 예: `feature/issue-12`)
- `$WT_FULL_ID` - 레포 prefix가 포함된 전체 ID (예: `myrepo-feature/issue-12`)
- `$WT_BRANCH` - 브랜치 이름
- `$WT_REPO_ROOT` - 저장소 루트 디렉토리의 전체 경로

### 설정 예시

**develop을 기본으로 하는 기본 설정:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "develop",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": [],
    "postMode": "async"
  }
}
```

**worktree 생성 후 의존성 설치:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": ["npm install"]
  }
}
```

**원격에 자동 푸시 및 의존성 설치:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": ["npm install", "code $WT_PATH"]
  }
}
```

**순차적 여러 명령어:**
```json
{
  "worktreeDir": "~/projects/worktrees",
  "baseBranch": "develop",
  "pushRemote": true,
  "scripts": {
    "pre": [
      "echo Creating worktree for branch: $WT_BRANCH"
    ],
    "post": [
      "npm install",
      "npm run build",
      "echo Worktree ready at $WT_PATH"
    ]
  }
}
```

## 아키텍처 개요

코드베이스는 얇은 CLI 어댑터와 레이어드 모듈 구조로 나뉘어 있습니다.

- `src/commands/*`: 옵션을 해석하고 사용자 출력만 담당하는 커맨드 핸들러
- `src/app/*`: 유스케이스와 워크플로 오케스트레이션
- `src/domain/*`: 설정/worktree 모델과 순수 해석 로직
- `src/infra/*`: git 접근, 저장소 파일 I/O, 스크립트 실행, shell 통합, updater 구현
- `src/utils/*`: 호환용 shim과 작은 공용 헬퍼

이 구조 덕분에 command 파일은 작게 유지되고, git 동작, 메타데이터 처리, 업데이트 로직은 서로 독립적으로 테스트하고 확장하기 쉬워집니다.

## 프로젝트 구조

```
wt/
├── src/
│   ├── index.ts               # Commander CLI 진입점
│   ├── cli/
│   │   └── command-runtime.ts # 공통 command 에러/exit 처리
│   ├── commands/
│   │   ├── init.ts            # wt init
│   │   ├── new.ts             # wt new
│   │   ├── pr.ts              # wt pr
│   │   ├── list.ts            # wt list / wt ls
│   │   ├── remove.ts          # wt remove / wt rm
│   │   ├── cd.ts              # wt cd
│   │   └── update.ts          # wt update
│   ├── app/
│   │   ├── repository-context.ts # 현재 cwd 기준 repo root/name 해석
│   │   ├── worktree-creation.ts  # 공통 생성 헬퍼와 스크립트 hook
│   │   ├── worktree-catalog.ts   # worktree 정보와 상태 집계
│   │   └── use-cases/            # command 워크플로
│   ├── domain/
│   │   ├── settings.ts        # 설정 스키마와 정규화
│   │   ├── worktree.ts        # worktree 모델과 메타데이터 헬퍼
│   │   └── worktree-target.ts # worktree 대상 해석 규칙
│   ├── infra/
│   │   ├── git/               # git 저장소/worktree/status 접근
│   │   ├── github/            # PR checkout용 GitHub CLI 연동
│   │   ├── storage/           # 설정 및 메타데이터 저장
│   │   ├── scripts/           # pre/post 스크립트 실행
│   │   ├── shell/             # shell cd handoff 및 wrapper 업데이트
│   │   └── update/            # 릴리스 조회 및 바이너리 교체
│   ├── config/
│   │   └── settings.ts        # 설정 접근용 호환 export
│   ├── types/
│   │   └── index.ts           # 공개 TypeScript 타입 re-export
│   ├── utils/
│   │   ├── git.ts             # 기존 git helper 호환 shim
│   │   ├── script.ts          # 기존 script helper 호환 shim
│   │   └── cd.ts              # shell cd handoff 호환 shim
├── shell/
│   ├── wt.zsh                 # Zsh wrapper 함수
│   ├── wt.bash                # Bash wrapper 함수
│   └── wt.fish                # Fish wrapper 함수
├── .github/workflows/ci.yml   # CI 체크
├── package.json
└── tsconfig.json
```

## 개발

```bash
# 의존성 설치
bun install

# 독립형 바이너리 빌드
bun run build

# ./wt에 바이너리가 생성됩니다
# 테스트: ./wt --help
```

## 라이선스

MIT
