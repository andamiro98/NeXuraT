export interface FragChunkInfo {
    index: number;
    sourceIfcName: string;
    fragFileName: string;
    fragPath: string;
    fragSizeBytes: number;
}
export interface FragChunkManifestEntry {
    index: number;
    sourceIfcName: string;
    fragFileName: string;
    fragSizeBytes: number;
    downloadPath: string;
}
export interface FragManifest {
    version: 1;
    fileId: string;
    sourceIfcName: string;
    createdAt: string;
    chunkTargetMb: number;
    totalChunks: number;
    mode: "single" | "chunked";
    chunks: FragChunkManifestEntry[];
}
export interface ChunkedConversionOptions {
    chunkTargetMb?: number;
}
export interface ChunkedConversionResult {
    mode: "single" | "chunked";
    manifestPath: string;
    fragFiles: string[];
    totalChunks: number;
    chunks: FragChunkInfo[];
}
export declare function convertIfcToFrag(ifcPath: string, fragPath: string): Promise<void>;
export declare function convertIfcToFragChunks(fileId: string, ifcPath: string, fragPath: string, options?: ChunkedConversionOptions): Promise<ChunkedConversionResult>;
