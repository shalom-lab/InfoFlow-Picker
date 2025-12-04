import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const pkgPath = path.join(rootDir, 'package.json');

const targets = {
  chrome: {
    manifest: path.join(rootDir, 'extension', 'manifest.chrome.json'),
  },
  firefox: {
    manifest: path.join(rootDir, 'extension', 'manifest.firefox.json'),
  },
};

const command = process.argv[2] ?? 'chrome';

if (command === 'watch') {
  await runWatch();
} else if (targets[command]) {
  await buildTarget(command);
} else {
  console.error(`Unknown build target: ${command}`);
  process.exitCode = 1;
}

async function runWatch() {
  await Promise.all(
    Object.keys(targets).map((target) => buildTarget(target, { watch: true })),
  );
  console.log('Watching for changes... Press Ctrl+C to stop.');
}

async function buildTarget(target, { watch = false } = {}) {
  const outDir = path.join(distDir, target);
  await fs.rm(outDir, { force: true, recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const buildOptions = {
    entryPoints: {
      background: path.join(srcDir, 'background', 'index.js'),
      content: path.join(srcDir, 'content', 'index.js'),
      'popup/index': path.join(srcDir, 'popup', 'index.js'),
      'options/index': path.join(srcDir, 'options', 'index.js'),
    },
    target: 'es2020',
    platform: 'browser',
    bundle: true,
    format: 'iife',
    sourcemap: true,
    outdir: outDir,
    loader: {
      '.json': 'json',
    },
  };

  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.rebuild();
    await afterBuild(target, outDir);
    await ctx.watch({
      onRebuild(error) {
        if (error) {
          console.error(`[${target}] Rebuild failed`, error);
          return;
        }
        afterBuild(target, outDir)
          .then(() => console.log(`[${target}] Rebuilt successfully`))
          .catch((err) =>
            console.error(`[${target}] Post-build failed`, err),
          );
      },
    });
    console.log(`[${target}] Watching for changes...`);
    return;
  }

  await esbuild.build(buildOptions);
  await afterBuild(target, outDir);

  if (!watch) {
    console.log(`[${target}] Build completed → ${outDir}`);
  }
}

async function afterBuild(target, outDir) {
  await Promise.all([
    writeManifest(target, outDir),
    copyPopup(outDir),
    copyOptions(outDir),
    copyAssets(outDir),
  ]);
}

async function copyPopup(outDir) {
  const srcPopupDir = path.join(srcDir, 'popup');
  const files = ['index.html'];
  await Promise.all(
    files.map((file) =>
      copyFile(path.join(srcPopupDir, file), path.join(outDir, 'popup', file)),
    ),
  );
}

async function copyOptions(outDir) {
  const srcOptionsDir = path.join(srcDir, 'options');
  const files = ['index.html'];
  await Promise.all(
    files.map((file) =>
      copyFile(
        path.join(srcOptionsDir, file),
        path.join(outDir, 'options', file),
      ),
    ),
  );
}

async function copyAssets(outDir) {
  const assetsDir = path.join(rootDir, 'extension', 'assets');
  await copyDirectory(assetsDir, path.join(outDir, 'assets'));
}

async function writeManifest(target, outDir) {
  const manifestTemplatePath = targets[target].manifest;
  const [manifestRaw, pkgRaw] = await Promise.all([
    fs.readFile(manifestTemplatePath, 'utf8'),
    fs.readFile(pkgPath, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const pkgJson = JSON.parse(pkgRaw);
  manifest.version = pkgJson.version;
  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDirectory(from, to) {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => {
      const srcPath = path.join(from, entry.name);
      const destPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        return copyDirectory(srcPath, destPath);
      }
      return copyFile(srcPath, destPath);
    }),
  );
}

