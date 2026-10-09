import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from '../core/context.mjs';

export async function buildPackages(output = join(packageRoot, 'dist')) {
  const directory = resolve(output);
  if (directory === resolve(packageRoot)) throw new Error('Package output must not replace the source root');
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  for (const harness of ['claude-code', 'codex', 'pi']) {
    const destination = join(directory, harness);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    const paths = ['core', 'workflows', `adapters/${harness}`];
    if (harness === 'claude-code') paths.push('skills', 'hooks', '.claude-plugin');
    if (harness === 'codex') paths.push('.codex-plugin');
    for (const path of paths) await cp(join(packageRoot, path), join(destination, path), { recursive: true });
    const metadata = {
      name: `agent-workflow-${harness}`, version: pkg.version, private: true,
      description: `Explicit Pair and Delegate workflows for ${harness}`,
      type: 'module', engines: pkg.engines,
      ...(harness === 'pi' ? { keywords: pkg.keywords, pi: pkg.pi } : {}),
    };
    await writeFile(join(destination, 'package.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    if (harness === 'codex') {
      // The installed Codex CLI supports the legacy marketplace location.
      // This catalog points at the Codex manifest, with no Claude runtime.
      const marketplace = JSON.parse(await readFile(join(packageRoot, '.claude-plugin/marketplace.json'), 'utf8'));
      marketplace.metadata.description = metadata.description;
      marketplace.plugins[0].description = metadata.description;
      await mkdir(join(destination, '.claude-plugin'));
      await writeFile(join(destination, '.claude-plugin/marketplace.json'), `${JSON.stringify(marketplace, null, 2)}\n`);
    }
    await writeFile(join(destination, 'README.md'),
      `# Agent Workflow for ${harness}\n\nVersion ${pkg.version}. Generated from the shared source; edit the source repository rather than this directory.\n\nSee https://github.com/Antoniodigiovanni/agent-workflow for installation, controls, and compatibility.\n`);
  }
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Built standalone Claude Code, Codex, and Pi packages in ${await buildPackages(process.argv[2])}`);
}
