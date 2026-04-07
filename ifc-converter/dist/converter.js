"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertIfcToFrag = convertIfcToFrag;
exports.convertIfcToFragChunks = convertIfcToFragChunks;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const FRAGS = __importStar(require("@thatopen/fragments"));
const DEFAULT_CHUNK_TARGET_MB = 800;
function getLocalWebIfcWasmDir() {
    const webIfcEntryPath = require.resolve("web-ifc");
    const webIfcDir = path.dirname(webIfcEntryPath);
    const wasmFilePath = path.join(webIfcDir, "web-ifc-node.wasm");
    if (!fs.existsSync(wasmFilePath)) {
        throw new Error([
            "web-ifc-node.wasm file not found.",
            `Checked path: ${wasmFilePath}`,
            `web-ifc entry path: ${webIfcEntryPath}`,
        ].join(" "));
    }
    return path.resolve(webIfcDir).replace(/\\/g, "/") + "/";
}
function getProjectRoot() {
    return path.resolve(__dirname, "..");
}
function getSplitScriptPath() {
    return path.resolve(getProjectRoot(), "src", "python", "split_ifc_streaming.py");
}
function getFragmentsSplitWorkerPath() {
    const projectRoot = getProjectRoot();
    const runningFromTypeScript = __filename.endsWith(".ts");
    const builtWorkerPath = path.resolve(projectRoot, "dist", "fragments-split-worker.js");
    if (!runningFromTypeScript && fs.existsSync(builtWorkerPath)) {
        return { scriptPath: builtWorkerPath, useTsNode: false };
    }
    return {
        scriptPath: path.resolve(projectRoot, "src", "fragments-split-worker.ts"),
        useTsNode: true,
    };
}
function readIfcBytesFromCallback(fd, offset, size) {
    const buffer = Buffer.allocUnsafe(size);
    const bytesRead = fs.readSync(fd, buffer, 0, size, offset);
    if (bytesRead <= 0) {
        return new Uint8Array(0);
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
}
function runSplitWithCommand(command, ifcPath, outDir, targetMb) {
    return new Promise((resolve, reject) => {
        const scriptPath = getSplitScriptPath();
        const child = (0, child_process_1.spawn)(command, [scriptPath, ifcPath, outDir, String(targetMb)], {
            cwd: getProjectRoot(),
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });
        child.on("error", (error) => {
            reject(error);
        });
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`IFC split process failed with code ${code}. ${(stderr || stdout).trim()}`));
                return;
            }
            const resultLine = stdout
                .split(/\r?\n/)
                .find((line) => line.startsWith("RESULT_FILES:"));
            if (!resultLine) {
                reject(new Error("IFC split completed without RESULT_FILES output."));
                return;
            }
            const chunkPaths = resultLine
                .slice("RESULT_FILES:".length)
                .split("|")
                .map((entry) => entry.trim())
                .filter(Boolean)
                .map((entry) => path.resolve(entry));
            resolve(chunkPaths);
        });
    });
}
async function runFragmentsSafeSplit(ifcPath, outDir, targetMb) {
    return new Promise((resolve, reject) => {
        const { scriptPath, useTsNode } = getFragmentsSplitWorkerPath();
        const heapMb = Math.max(4096, Number(process.env.IFC_SPLIT_HEAP_MB || 16384));
        const childArgs = [`--max-old-space-size=${heapMb}`];
        if (useTsNode) {
            childArgs.push("-r", "ts-node/register");
        }
        childArgs.push(scriptPath, ifcPath, outDir, String(targetMb));
        console.log(`  Launching Fragments split worker with heap=${heapMb}MB`);
        const child = (0, child_process_1.spawn)(process.execPath, childArgs, {
            cwd: getProjectRoot(),
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(text);
        });
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(text);
        });
        child.on("error", (error) => {
            reject(error);
        });
        child.on("close", (code) => {
            if (code !== 0) {
                const message = (stderr || stdout).trim();
                reject(new Error(`Fragments split worker failed with code ${code}. ${message}`));
                return;
            }
            const resultLine = stdout
                .split(/\r?\n/)
                .find((line) => line.startsWith("RESULT_FILES:"));
            if (!resultLine) {
                reject(new Error("Fragments split worker completed without RESULT_FILES output."));
                return;
            }
            const chunkPaths = resultLine
                .slice("RESULT_FILES:".length)
                .split("|")
                .map((entry) => entry.trim())
                .filter(Boolean)
                .map((entry) => path.resolve(entry));
            resolve(chunkPaths);
        });
    });
}
async function runSplitIfcStreaming(ifcPath, outDir, targetMb) {
    const scriptPath = getSplitScriptPath();
    if (!fs.existsSync(scriptPath)) {
        throw new Error(`Split script not found: ${scriptPath}`);
    }
    try {
        return await runSplitWithCommand(process.platform === "win32" ? "py" : "python3", ifcPath, outDir, targetMb);
    }
    catch (error) {
        const message = String(error?.message || "");
        const isMissingExecutable = message.includes("ENOENT") ||
            message.includes("'py'") ||
            message.includes("not recognized");
        if (process.platform === "win32" && isMissingExecutable) {
            return runSplitWithCommand("python", ifcPath, outDir, targetMb);
        }
        throw error;
    }
}
async function splitIfcForFragConversion(ifcPath, outDir, targetMb) {
    const fileSize = fs.statSync(ifcPath).size;
    const isVeryLargeIfc = fileSize >= 2 * 1024 * 1024 * 1024;
    try {
        return await runSplitIfcStreaming(ifcPath, outDir, targetMb);
    }
    catch (error) {
        console.warn("  split_ifc_streaming.py failed, falling back to the Fragments split worker:", error?.message || error);
        try {
            return await runFragmentsSafeSplit(ifcPath, outDir, targetMb);
        }
        catch (fallbackError) {
            if (isVeryLargeIfc) {
                throw new Error(`IFC chunk split failed. Python splitter: ${error?.message || error} Fragments worker: ${fallbackError?.message || fallbackError}`);
            }
            throw fallbackError;
        }
    }
}
async function convertIfcToFrag(ifcPath, fragPath) {
    if (!fs.existsSync(ifcPath)) {
        throw new Error(`IFC file not found: ${ifcPath}`);
    }
    const outputDir = path.dirname(fragPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const wasmDir = getLocalWebIfcWasmDir();
    const fileSize = fs.statSync(ifcPath).size;
    console.log(`  web-ifc WASM path: ${wasmDir}`);
    console.log(`  Reading IFC via callback: ${ifcPath}`);
    console.log(`  IFC size: ${(fileSize / (1024 * 1024)).toFixed(1)}MB`);
    const fd = fs.openSync(ifcPath, "r");
    try {
        const importer = new FRAGS.IfcImporter();
        importer.wasm = {
            path: wasmDir,
            absolute: true,
        };
        const fragArrayBuffer = await importer.process({
            readFromCallback: true,
            readCallback: (offset, size) => readIfcBytesFromCallback(fd, offset, size),
        });
        fs.writeFileSync(fragPath, Buffer.from(fragArrayBuffer));
    }
    finally {
        fs.closeSync(fd);
    }
    console.log(`  Saved .frag: ${fragPath}`);
    console.log(`  Output size: ${(fs.statSync(fragPath).size / (1024 * 1024)).toFixed(1)}MB`);
}
async function convertIfcToFragChunks(fileId, ifcPath, fragPath, options = {}) {
    if (!fs.existsSync(ifcPath)) {
        throw new Error(`IFC file not found: ${ifcPath}`);
    }
    const chunkTargetMb = options.chunkTargetMb ?? DEFAULT_CHUNK_TARGET_MB;
    const baseOutputDir = path.dirname(fragPath);
    const jobDir = path.join(baseOutputDir, fileId);
    const splitDir = path.join(jobDir, "tmp-ifc-chunks");
    const fragDir = path.join(jobDir, "frag-chunks");
    const manifestPath = path.join(jobDir, "manifest.json");
    if (fs.existsSync(jobDir)) {
        fs.rmSync(jobDir, { recursive: true, force: true });
    }
    fs.mkdirSync(splitDir, { recursive: true });
    fs.mkdirSync(fragDir, { recursive: true });
    console.log(`  Split target size: ${chunkTargetMb}MB`);
    console.log(`  Split output dir: ${splitDir}`);
    const chunkIfcPaths = await splitIfcForFragConversion(ifcPath, splitDir, chunkTargetMb);
    if (chunkIfcPaths.length === 0) {
        throw new Error("No IFC chunks were generated.");
    }
    const chunks = [];
    try {
        for (let i = 0; i < chunkIfcPaths.length; i++) {
            const chunkIfcPath = chunkIfcPaths[i];
            const chunkBaseName = path.basename(chunkIfcPath, path.extname(chunkIfcPath));
            const fragFileName = `${chunkBaseName}.frag`;
            const chunkFragPath = path.join(fragDir, fragFileName);
            console.log(`[chunk ${i + 1}/${chunkIfcPaths.length}] ${path.basename(chunkIfcPath)} -> ${fragFileName}`);
            await convertIfcToFrag(chunkIfcPath, chunkFragPath);
            chunks.push({
                index: i,
                sourceIfcName: path.basename(chunkIfcPath),
                fragFileName,
                fragPath: chunkFragPath,
                fragSizeBytes: fs.statSync(chunkFragPath).size,
            });
        }
    }
    finally {
        if (fs.existsSync(splitDir)) {
            fs.rmSync(splitDir, { recursive: true, force: true });
        }
    }
    const manifest = {
        version: 1,
        fileId,
        sourceIfcName: path.basename(ifcPath),
        createdAt: new Date().toISOString(),
        chunkTargetMb,
        totalChunks: chunks.length,
        mode: chunks.length > 1 ? "chunked" : "single",
        chunks: chunks.map(({ index, sourceIfcName, fragFileName, fragSizeBytes }) => ({
            index,
            sourceIfcName,
            fragFileName,
            fragSizeBytes,
            downloadPath: `/api/ifc/${fileId}/frag/${index}`,
        })),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`  Manifest saved: ${manifestPath}`);
    return {
        mode: manifest.mode,
        manifestPath,
        fragFiles: chunks.map((chunk) => chunk.fragPath),
        totalChunks: chunks.length,
        chunks,
    };
}
