export interface HomebrewFormulaOptions {
  version: string;
  macosArm64Sha256: string;
  macosX64Sha256: string;
}

export function renderHomebrewFormula(
  options: HomebrewFormulaOptions
): string {
  return `class Wt < Formula
  desc "Git worktree manager CLI"
  homepage "https://github.com/leesangb/wt"
  version "${options.version}"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/leesangb/wt/releases/download/v${options.version}/wt-macos-arm64"
      sha256 "${options.macosArm64Sha256}"
    end

    on_intel do
      url "https://github.com/leesangb/wt/releases/download/v${options.version}/wt-macos-x64"
      sha256 "${options.macosX64Sha256}"
    end
  end

  def install
    if Hardware::CPU.arm?
      bin.install "wt-macos-arm64" => "wt"
    else
      bin.install "wt-macos-x64" => "wt"
    end
  end

  def caveats
    <<~EOS
      Optional shell integration:
        wt shell install zsh
        wt shell install bash
        wt shell install fish

      Upgrade with Homebrew:
        brew upgrade wt

      Run the command printed by \`wt shell install\` to append it to your shell config.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("\#{bin}/wt --version")
  end
end
`;
}
