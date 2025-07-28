import { clearLine, cursorTo } from "readline";

export class Logger {
  private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private currentFrame = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;

  startSpinner(message: string): void {
    process.stdout.write(`${this.spinnerFrames[0]} ${message}`);

    this.spinnerInterval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.spinnerFrames.length;
      cursorTo(process.stdout, 0);
      process.stdout.write(
        `${this.spinnerFrames[this.currentFrame]} ${message}`
      );
    }, 100);
  }

  stopSpinner(successMessage?: string, isError = false): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }

    cursorTo(process.stdout, 0);
    clearLine(process.stdout, 0);

    if (successMessage) {
      const icon = isError ? "❌" : "✅";
      console.log(`${icon} ${successMessage}`);
    }
  }

  updateLine(message: string): void {
    cursorTo(process.stdout, 0);
    clearLine(process.stdout, 0);
    process.stdout.write(message);
  }

  updateSpinner(message: string): void {
    if (this.spinnerInterval) {
      cursorTo(process.stdout, 0);
      clearLine(process.stdout, 0);
      process.stdout.write(
        `${this.spinnerFrames[this.currentFrame]} ${message}`
      );
    }
  }

  fileOutput(filePath: string): void {
    console.log(`📄 Output: file://${filePath}`);
  }

  success(message: string): void {
    console.log(`✅ ${message}`);
  }

  error(message: string): void {
    console.log(`❌ ${message}`);
  }

  info(message: string): void {
    console.log(`ℹ️  ${message}`);
  }

  warning(message: string): void {
    console.log(`⚠️  ${message}`);
  }

  section(title: string): void {
    console.log(`\n📋 ${title}`);
    console.log("─".repeat(50));
  }

  result(
    nonce: number | string,
    userWallet?: string,
    partnerWallet?: string,
    amount?: string,
    token?: string,
    network?: number
  ): void {
    // This method is now disabled - results are not displayed
  }

  summary(total: number, label: string): void {
    if (total === 0) {
      console.log(`   🔍 No ${label} found`);
    } else {
      console.log(`   📊 Found ${total} ${label}`);
    }
    console.log("");
  }
}
