import child_process from "child_process";
import parseDiff from "parse-diff";
import util from "util";
import { AbsolutePath, RelativePath } from "./paths";
import { FileChanges } from "./fileChanges";

// This is sort of a hack, but it works
const exec = (util as any).promisify(child_process.exec);

export interface VersionProvider {
  getCurrentVersion(path: AbsolutePath): Promise<string | null>;
  getChangesForFile(
    version: string,
    path: RelativePath,
    repoPath: AbsolutePath,
  ): Promise<FileChanges | null>;
}

export class GitProvider implements VersionProvider {
  public async getCurrentVersion(path: AbsolutePath): Promise<string | null> {
    return await this.headCommit(path);
  }

  public async getChangesForFile(
    version: string,
    path: RelativePath,
    repoPath: AbsolutePath,
  ): Promise<FileChanges | null> {
    return await this.gitDiffFile(version, path, repoPath);
  }

  public async git(
    path: AbsolutePath,
    command: string,
    args: string[],
  ): Promise<string> {
    const fullCommand = `git -C ${path.path} ${command} ${args.join(" ")}`;
    const res = await exec(fullCommand);
    if (res.stderr) {
      throw new Error(res.stderr);
    }
    return res.stdout;
  }

  private async headCommit(repoPath: AbsolutePath): Promise<string | null> {
    try {
      const commit = await this.git(repoPath, "rev-parse", ["HEAD"]);
      return commit.trim();
    } catch (_) {
      return null;
    }
  }

  private async gitDiffFile(
    commit: string,
    path: RelativePath,
    repoPath: AbsolutePath,
  ): Promise<FileChanges | null> {
    const diff = await this.git(repoPath, "diff", [
      "--minimal",
      "--ignore-space-at-eol",
      "-M",
      `${commit}...`,
      "--",
      ".",
    ]);
    const file = parseDiff(diff).find((f) => f.from === path.path);

    const moves = new Map();
    const additions = [] as number[];
    const deletions = [] as number[];

    if (!file || file.from !== path.path) {
      return new FileChanges(additions, deletions, moves, path.path);
    }

    for (const chunk of await file.chunks) {
      for (const change of await chunk.changes) {
        switch (change.type) {
          case "add":
            if (!additions.find((x) => change.ln === x)) {
              additions.push(change.ln);
            }
            break;
          case "del":
            if (!deletions.find((x) => change.ln === x)) {
              deletions.push(change.ln);
            }
            break;
          case "normal":
            moves.set(change.ln1, change.ln2);
            break;
        }
      }
    }

    return new FileChanges(additions, deletions, moves, file.to || file.from);
  }
}
