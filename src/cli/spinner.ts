export interface SpinnerStream {
  isTTY?: boolean;
  write(chunk: string): boolean;
  clearLine?(dir: -1 | 0 | 1): boolean;
  cursorTo?(x: number, y?: number): boolean;
}

interface SpinnerController {
  stop: () => void;
  succeed: (message?: string) => void;
  fail: (message?: string) => void;
}

interface SpinnerOptions {
  stream?: SpinnerStream;
  intervalMs?: number;
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;

function clearSpinnerLine(
  stream: SpinnerStream,
  renderedLineLength: number
): void {
  if (
    typeof stream.clearLine === "function" &&
    typeof stream.cursorTo === "function"
  ) {
    stream.clearLine(0);
    stream.cursorTo(0);
    return;
  }

  stream.write(`\r${" ".repeat(renderedLineLength)}\r`);
}

export function startSpinner(
  text: string,
  options: SpinnerOptions = {}
): SpinnerController {
  const stream = options.stream ?? process.stderr;
  const intervalMs = options.intervalMs ?? 80;

  if (!stream.isTTY) {
    return {
      stop() {},
      succeed(message?: string) {
        if (message) {
          stream.write(`${message}\n`);
        }
      },
      fail(message?: string) {
        if (message) {
          stream.write(`${message}\n`);
        }
      },
    };
  }

  let frameIndex = 0;
  let active = true;
  let renderedLineLength = 0;

  const render = () => {
    const line = `${SPINNER_FRAMES[frameIndex]} ${text}`;
    renderedLineLength = line.length;
    stream.write(`\r${line}`);
  };

  const finish = (message?: string) => {
    if (!active) {
      if (message) {
        stream.write(`${message}\n`);
      }
      return;
    }

    active = false;
    clearInterval(timer);
    clearSpinnerLine(stream, renderedLineLength);

    if (message) {
      stream.write(`${message}\n`);
    }
  };

  render();

  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    render();
  }, intervalMs);

  timer.unref?.();

  return {
    stop() {
      finish();
    },
    succeed(message?: string) {
      finish(message);
    },
    fail(message?: string) {
      finish(message);
    },
  };
}

interface RunWithSpinnerOptions extends SpinnerOptions {
  successText?: string;
  failureText?: string;
}

export async function runWithSpinner<T>(
  text: string,
  action: () => Promise<T>,
  options: RunWithSpinnerOptions = {}
): Promise<T> {
  const spinner = startSpinner(text, options);

  try {
    const result = await action();
    spinner.succeed(options.successText);
    return result;
  } catch (error) {
    spinner.fail(options.failureText);
    throw error;
  }
}
