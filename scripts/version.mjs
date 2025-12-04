import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgPath = path.join(__dirname, '..', 'package.json');

const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));

// 如果通过环境变量传入 VERSION，则直接使用该版本号
const explicitVersion = process.env.VERSION;

if (explicitVersion) {
  pkg.version = explicitVersion;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Synced version from env: ${explicitVersion}`);
} else {
  // 否则保持原来的「自动 patch +1」逻辑（方便本地调试时使用）
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  const nextVersion = [major, minor, (patch ?? 0) + 1].join('.');
  pkg.version = nextVersion;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Bumped version to ${nextVersion}`);
}
