/**
 * Git Engine for CompanyOS.
 * Safely executes git operations on feature branches.
 * NEVER touches main/master. Push requires explicit human approval.
 */

import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = process.env.GIT_REPO_ROOT || path.resolve(process.cwd(), "..");

function git(cmd, cwd = ROOT) {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
  } catch (error) {
    throw new Error(`git ${cmd} failed: ${error.stderr || error.message}`);
  }
}

export function getCurrentBranch() {
  return git("rev-parse --abbrev-ref HEAD");
}

export function branchName(deptId, taskSlug) {
  const slug = taskSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return `company-os/${deptId}/${slug}`;
}

export function createBranch(deptId, taskSlug) {
  const branch = branchName(deptId, taskSlug);
  const base = getCurrentBranch();
  try { git(`branch -D ${branch}`); } catch { /* branch may not exist */ }
  git(`checkout -b ${branch}`);
  return { branch, base };
}

export function stageAndCommit(files, message) {
  if (!files.length) throw new Error("No files to commit");
  for (const f of files) git(`add "${f}"`);
  git(`commit -m "${message.replace(/"/g, '\\"')}"`);
  const hash = git("rev-parse --short HEAD");
  return { hash, message, files };
}

export function getBranchDiff(branch) {
  const base = git("merge-base main " + branch).trim() || git("merge-base master " + branch).trim();
  return git(`diff ${base}..${branch} --stat`) + "\n\n" + git(`diff ${base}..${branch}`);
}

export function pushBranch(branch) {
  if (branch === "main" || branch === "master") throw new Error("SAFETY: Cannot push to main/master");
  git(`push origin ${branch}`);
  return { pushed: true, branch };
}

export function switchBack(baseBranch = "main") {
  git(`checkout ${baseBranch}`);
}

export function getStatus() {
  return git("status --short");
}

export function getLog(n = 5) {
  return git(`log --oneline -${n}`);
}

export default { getCurrentBranch, branchName, createBranch, stageAndCommit, getBranchDiff, pushBranch, switchBack, getStatus, getLog };
