import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import * as PELibrary from "pe-library";
import * as ResEdit from "resedit";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = scriptRoot;
const projectRoot = path.resolve(appRoot, "..", "..");
const configPath = path.join(projectRoot, "config.yml");
const exePath = path.join(projectRoot, "MtoPB.exe");
const config = YAML.parse(fs.readFileSync(configPath, "utf8"));
const version = String(config.version).trim().replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
    throw new Error(`config.yml 中的版本号必须为 1.2.3 或 1.2.3.4 格式，当前为：${JSON.stringify(version)}`);
}


const source = fs.readFileSync(exePath);
const exe = PELibrary.NtExecutable.from(source, { ignoreCert: true });
const resources = PELibrary.NtExecutableResource.from(exe);
const versionInfo = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0];
if (!versionInfo) throw new Error("MtoPB.exe 中没有找到 Windows 版本信息资源。");

const translation = { lang: 2052, codepage: 1200 };
for (const language of versionInfo.getAllLanguagesForStringValues()) {
    versionInfo.removeAllStringValues(language, false);
}
versionInfo.replaceAvailableLanguages([]);
versionInfo.setProductVersion(version, translation.lang);
versionInfo.setStringValues(translation, {
    CompanyName: "GeorgeNaNN",
    FileDescription: "MtoPB：Markdown 生成带封面、目录的PDF书籍",
    ProductName: "MtoPB",
    ProductVersion: version
});
versionInfo.outputToResourceEntries(resources.entries);
resources.outputResource(exe);

const temporaryPath = `${exePath}.version-tmp`;
const backupPath = `${exePath}.version-backup`;
fs.writeFileSync(temporaryPath, Buffer.from(exe.generate()));
try {
    if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { force: true });
    fs.renameSync(exePath, backupPath);
    fs.renameSync(temporaryPath, exePath);
    try {
        fs.rmSync(backupPath, { force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
        console.warn(`版本已更新，但旧文件暂时被占用，备份保留在：${backupPath}`);
    }
} catch (error) {
    if (!fs.existsSync(exePath) && fs.existsSync(backupPath)) fs.renameSync(backupPath, exePath);
    throw error;
} finally {
    fs.rmSync(temporaryPath, { force: true });
}

console.log(`版本同步完成：MtoPB v${version}`);
