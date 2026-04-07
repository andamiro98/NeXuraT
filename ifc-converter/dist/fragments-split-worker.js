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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const FRAGS = __importStar(require("@thatopen/fragments"));
function main() {
    const [, , ifcPathArg, outDirArg, targetMbArg] = process.argv;
    if (!ifcPathArg || !outDirArg) {
        console.error("Usage: node fragments-split-worker <ifcPath> <outDir> [targetMb]");
        process.exit(1);
    }
    const ifcPath = path_1.default.resolve(ifcPathArg);
    const outDir = path_1.default.resolve(outDirArg);
    const targetMb = Math.max(1, Number(targetMbArg || 800));
    if (!fs_1.default.existsSync(ifcPath)) {
        console.error(`Input IFC file does not exist: ${ifcPath}`);
        process.exit(1);
    }
    fs_1.default.mkdirSync(outDir, { recursive: true });
    const fileSize = fs_1.default.statSync(ifcPath).size;
    const targetBytes = targetMb * 1024 * 1024;
    const estimatedChunkCount = Math.max(1, Math.ceil(fileSize / targetBytes));
    console.log(`  Fragments split target size: ${targetMb}MB`);
    console.log(`  Fragments split estimated chunks: ${estimatedChunkCount}`);
    FRAGS.split({ fs: fs_1.default, path: path_1.default }, ifcPath, estimatedChunkCount, outDir);
    const chunkIfcPaths = fs_1.default
        .readdirSync(outDir)
        .filter((entry) => entry.toLowerCase().endsWith(".ifc"))
        .sort()
        .map((entry) => path_1.default.join(outDir, entry));
    if (chunkIfcPaths.length === 0) {
        console.error("Fragments split completed without IFC chunks.");
        process.exit(1);
    }
    console.log(`RESULT_FILES:${chunkIfcPaths.join("|")}`);
}
main();
