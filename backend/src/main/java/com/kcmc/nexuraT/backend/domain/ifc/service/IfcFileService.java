package com.kcmc.nexuraT.backend.domain.ifc.service;

import com.kcmc.nexuraT.backend.domain.ifc.dto.ConversionStatusResponse;
import com.kcmc.nexuraT.backend.domain.ifc.dto.UploadResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.IntStream;

@Slf4j
@Service
@RequiredArgsConstructor
public class IfcFileService {

    @Value("${ifc.storage.base-path:./ifc-storage}")
    private String basePath;

    private final IfcConversionService conversionService;

    private final Map<String, FileRecord> fileRecords = new ConcurrentHashMap<>();

    public UploadResponse handleUpload(MultipartFile file) {
        String fileId = UUID.randomUUID().toString();
        String originalName = file.getOriginalFilename();

        try {
            Path baseDir = Paths.get(basePath).toAbsolutePath().normalize();
            Path uploadDir = baseDir.resolve("uploads");
            Files.createDirectories(uploadDir);

            Path targetPath = uploadDir.resolve(fileId + ".ifc");

            try (InputStream in = file.getInputStream();
                 OutputStream out = Files.newOutputStream(targetPath)) {
                byte[] buffer = new byte[8 * 1024 * 1024];
                int bytesRead;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                }
            }

            FileRecord record = new FileRecord();
            record.fileId = fileId;
            record.originalName = originalName;
            record.fileSize = Files.size(targetPath);
            record.status = "UPLOADED";
            record.ifcPath = targetPath.toAbsolutePath().normalize().toString();

            fileRecords.put(fileId, record);

            log.info("IFC upload completed: {} ({}MB) path={}",
                    originalName, record.fileSize / (1024 * 1024), record.ifcPath);

            return UploadResponse.builder()
                    .fileId(fileId)
                    .originalName(originalName)
                    .fileSize(record.fileSize)
                    .status("UPLOADED")
                    .message("Upload completed. Call /convert to start chunked conversion.")
                    .build();

        } catch (IOException e) {
            log.error("File upload failed", e);
            throw new RuntimeException("File upload error: " + e.getMessage());
        }
    }

    public ConversionStatusResponse requestConversion(String fileId) {
        FileRecord record = getRecord(fileId);

        if ("CONVERTING".equals(record.status)) {
            return ConversionStatusResponse.builder()
                    .fileId(fileId)
                    .status("CONVERTING")
                    .message("Conversion is already in progress.")
                    .build();
        }

        if ("COMPLETED".equals(record.status)) {
            return buildCompletedStatus(record, "Conversion already completed.");
        }

        record.status = "CONVERTING";
        record.errorMessage = null;

        conversionService.convertAsync(fileId, record.ifcPath, getLegacyFragPath(fileId))
                .thenAccept(result -> {
                    if (result.isSuccess()) {
                        applyConversionResult(record, result);
                        record.errorMessage = null;
                        record.status = "COMPLETED";
                        log.info("Conversion completed: fileId={}, chunks={}", fileId, record.totalChunks);
                    } else {
                        record.status = "FAILED";
                        record.errorMessage = result.getErrorMessage();
                        log.error("Conversion failed: fileId={}, reason={}", fileId, record.errorMessage);
                    }
                });

        return ConversionStatusResponse.builder()
                .fileId(fileId)
                .status("CONVERTING")
                .message("Chunked conversion started. Poll /status to track completion.")
                .build();
    }

    public ConversionStatusResponse getConversionStatus(String fileId) {
        FileRecord record = getRecord(fileId);

        if ("COMPLETED".equals(record.status)) {
            return buildCompletedStatus(record, "Conversion completed. Chunked .frag files are ready.");
        }

        if ("FAILED".equals(record.status)) {
            return ConversionStatusResponse.builder()
                    .fileId(fileId)
                    .status("FAILED")
                    .message(record.errorMessage != null ? record.errorMessage : "Conversion failed.")
                    .build();
        }

        return ConversionStatusResponse.builder()
                .fileId(fileId)
                .status(record.status)
                .message("Conversion in progress.")
                .build();
    }

    public Resource getFragFile(String fileId) {
        FileRecord record = getRecord(fileId);
        ensureCompleted(record);

        String storedPath = record.fragPath;
        if (storedPath == null && record.fragFiles != null && !record.fragFiles.isEmpty()) {
            storedPath = record.fragFiles.get(0);
        }

        return new FileSystemResource(resolveExistingPath(storedPath, ".frag"));
    }

    public Resource getFragFileByIndex(String fileId, int chunkIndex) {
        FileRecord record = getRecord(fileId);
        ensureCompleted(record);

        if (record.fragFiles == null || record.fragFiles.isEmpty()) {
            if (chunkIndex == 0 && record.fragPath != null) {
                return new FileSystemResource(resolveExistingPath(record.fragPath, ".frag"));
            }
            throw new RuntimeException("No chunked .frag files exist for fileId=" + fileId);
        }

        if (chunkIndex < 0 || chunkIndex >= record.fragFiles.size()) {
            throw new RuntimeException("Chunk index out of range: " + chunkIndex
                    + " (total: " + record.fragFiles.size() + ")");
        }

        return new FileSystemResource(resolveExistingPath(record.fragFiles.get(chunkIndex), ".frag"));
    }

    public Resource getManifestFile(String fileId) {
        FileRecord record = getRecord(fileId);
        ensureCompleted(record);
        return new FileSystemResource(resolveExistingPath(record.manifestPath, "manifest"));
    }

    private ConversionStatusResponse buildCompletedStatus(FileRecord record, String message) {
        ConversionStatusResponse.ConversionStatusResponseBuilder builder = ConversionStatusResponse.builder()
                .fileId(record.fileId)
                .status("COMPLETED")
                .message(message)
                .manifestUrl(record.manifestPath == null ? null : "/api/ifc/" + record.fileId + "/manifest")
                .totalChunks(record.totalChunks);

        if (record.fragPath != null || (record.fragFiles != null && !record.fragFiles.isEmpty())) {
            builder.fragDownloadUrl("/api/ifc/" + record.fileId + "/frag");
        }

        if (record.fragFiles != null && !record.fragFiles.isEmpty()) {
            builder.fragDownloadUrls(
                    IntStream.range(0, record.fragFiles.size())
                            .mapToObj(i -> "/api/ifc/" + record.fileId + "/frag/" + i)
                            .toList()
            );
        } else if (record.fragPath != null) {
            builder.fragDownloadUrls(Collections.singletonList("/api/ifc/" + record.fileId + "/frag"));
            builder.totalChunks(1);
        }

        return builder.build();
    }

    private void applyConversionResult(FileRecord record, IfcConversionService.ConversionResult result) {
        List<String> fragFiles = result.getFragFiles();
        if (fragFiles == null || fragFiles.isEmpty()) {
            fragFiles = result.getFragPath() == null
                    ? Collections.emptyList()
                    : Collections.singletonList(result.getFragPath());
        }

        record.fragFiles = fragFiles;
        record.fragPath = result.getFragPath() != null
                ? result.getFragPath()
                : (fragFiles.isEmpty() ? null : fragFiles.get(0));
        record.manifestPath = result.getManifestPath();
        record.totalChunks = result.getTotalChunks() != null
                ? result.getTotalChunks()
                : (fragFiles.isEmpty() ? null : fragFiles.size());
        record.errorMessage = null;
    }

    private void ensureCompleted(FileRecord record) {
        if (!"COMPLETED".equals(record.status)) {
            throw new RuntimeException("Conversion is not completed yet. Current status: " + record.status);
        }
    }

    private Path resolveExistingPath(String storedPath, String label) {
        if (storedPath == null || storedPath.isBlank()) {
            throw new RuntimeException(label + " path is empty.");
        }

        Path resolvedPath = Paths.get(storedPath).toAbsolutePath().normalize();
        if (!Files.exists(resolvedPath)) {
            throw new RuntimeException(label + " file not found: " + resolvedPath);
        }
        return resolvedPath;
    }

    private FileRecord getRecord(String fileId) {
        FileRecord record = fileRecords.get(fileId);
        if (record == null) {
            throw new RuntimeException("File not found: " + fileId);
        }
        return record;
    }

    private String getLegacyFragPath(String fileId) {
        return Paths.get(basePath)
                .toAbsolutePath()
                .normalize()
                .resolve("converted")
                .resolve(fileId + ".frag")
                .toString();
    }

    static class FileRecord {
        String fileId;
        String originalName;
        long fileSize;
        String status;
        String ifcPath;
        String fragPath;
        String manifestPath;
        Integer totalChunks;
        List<String> fragFiles;
        String errorMessage;
    }
}
