# wt - Git Worktree 매니저

[English](./README.md) | 한국어

pre/post 스크립트 지원이 포함된 git worktree 관리 CLI 도구입니다.

## 기능

- 🚀 짧은 ID와 저장소 기반 이름으로 worktree 생성
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

**참고:** 제거 스크립트는 worktree나 저장소별 `.wt/settings.json` 파일을 제거하지 않습니다. 완전히 정리하려면 수동으로 실행하세요:
```bash
rm -rf ~/.wt/  # 모든 worktree와 shell 스크립트 제거
```

### Shell 통합 없이 사용

shell wrapper를 설정하지 않은 경우 `--no-cd` 플래그를 사용할 수 있습니다:

```bash
wt new feature-branch --no-cd
# 그 다음 수동으로: cd /출력에/표시된/경로
```

## 사용법

**참고:** `wt`는 git 저장소 내부 어느 디렉터리에서나 실행할 수 있습니다. 명령어는 내부적으로 저장소 루트를 기준으로 컨텍스트를 해석하며, `.wt/settings.json`의 상대 `worktreeDir` 값도 저장소 루트를 기준으로 해석됩니다.

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
    "post": []
  }
}
```

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
3. `~/.wt/<저장소명-짧은ID>`에 `feature-branch` 브랜치로 worktree 생성
4. 새 브랜치를 원격에 upstream 추적과 함께 푸시 (`--no-push`를 사용하지 않는 경우)
5. 새 worktree에서 post 스크립트 실행 (설정된 경우)
6. 새 worktree 디렉토리로 자동 이동 (shell wrapper 사용 시)

post 스크립트를 async 모드로 실행하면 `wt`는 즉시 반환되고, `<worktree>/.wt/` 아래에 상태/로그 파일(`post-task.json`, `post-task.log`)이 생성됩니다.

**옵션:**
- `--base <branch>` - 생성할 기본 브랜치 (기본값: 설정 또는 `main`)
- `--no-push` - 새 브랜치를 원격에 푸시하지 않음
- `--no-cd` - cd 명령 출력 안 함 (shell wrapper 없이 직접 바이너리 사용 시)

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
wt remove <id>
# 또는
wt rm <id>
```

다음 방법으로 worktree를 제거할 수 있습니다:
- 짧은 ID (예: `x7k2m9n4`)
- 레포 prefix가 포함된 전체 ID (예: `myrepo-x7k2m9n4`)
- worktree를 고유하게 식별할 수 있는 경로의 일부

## 설정

저장소의 `.wt/settings.json`을 편집하세요:

- **worktreeDir**: worktree의 기본 디렉토리 (기본값: `~/.wt`)
- **baseBranch**: 새 worktree의 기본 브랜치 (기본값: `main`)
- **pushRemote**: 새 브랜치를 원격에 자동 푸시 (기본값: `true`)
- **scripts.pre**: worktree 생성 전에 실행할 명령어 배열 (저장소 루트에서 실행)
- **scripts.post**: worktree 생성 후에 실행할 명령어 배열 (새 worktree 디렉토리에서 실행)
- **scripts.postMode**: `async`(기본값) 또는 `sync`(포그라운드 실행)

### 환경 변수

스크립트는 다음 환경 변수에 접근할 수 있습니다:

- `$WT_PATH` - worktree 디렉토리의 전체 경로
- `$WT_ID` - worktree의 짧은 ID (예: `x7k2m9n4`)
- `$WT_FULL_ID` - 레포 prefix가 포함된 전체 ID (예: `myrepo-x7k2m9n4`)
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
│   │   ├── list.ts            # wt list / wt ls
│   │   ├── remove.ts          # wt remove / wt rm
│   │   ├── cd.ts              # wt cd
│   │   └── update.ts          # wt update
│   ├── app/
│   │   ├── repository-context.ts # 현재 cwd 기준 repo root/name 해석
│   │   ├── worktree-catalog.ts   # worktree 정보와 상태 집계
│   │   └── use-cases/            # command 워크플로
│   ├── domain/
│   │   ├── settings.ts        # 설정 스키마와 정규화
│   │   ├── worktree.ts        # worktree 모델과 메타데이터 헬퍼
│   │   └── worktree-target.ts # worktree 대상 해석 규칙
│   ├── infra/
│   │   ├── git/               # git 저장소/worktree/status 접근
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
│   │   ├── cd.ts              # shell cd handoff 호환 shim
│   │   └── id.ts              # 짧은 ID 생성
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
