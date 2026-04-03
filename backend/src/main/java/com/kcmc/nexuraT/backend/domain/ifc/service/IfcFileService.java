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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
@RequiredArgsConstructor
public class IfcFileService {

    @Value("${ifc.storage.base-path:./ifc-storage}")
    private String basePath;

    private final IfcConversionService conversionService;

    // MVP: 인메모리 관리. 프로덕션에서는 JPA Entity + DB로 전환
    private final Map<String, FileRecord> fileRecords = new ConcurrentHashMap<>();

    /**
     * IFC 파일을 스트리밍 방식으로 디스크에 저장.
     * 8MB 버퍼로 읽어 쓰므로 브라우저와 달리 전체를 메모리에 올리지 않는다.
     */
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

            log.info("IFC 업로드 완료: {} ({}MB) path={}",
                    originalName, record.fileSize / (1024 * 1024), record.ifcPath);

            return UploadResponse.builder()
                    .fileId(fileId)
                    .originalName(originalName)
                    .fileSize(record.fileSize)
                    .status("UPLOADED")
                    .message("업로드 완료. /convert를 호출하여 변환을 시작하세요.")
                    .build();

        } catch (IOException e) {
            log.error("파일 업로드 실패", e);
            throw new RuntimeException("파일 업로드 중 오류 발생: " + e.getMessage());
        }
    }

    /**
     * Node.js 변환 서비스에 변환 요청
     */
    public ConversionStatusResponse requestConversion(String fileId) {
        FileRecord record = getRecord(fileId);

        if ("CONVERTING".equals(record.status)) {
            return ConversionStatusResponse.builder()
                    .fileId(fileId).status("CONVERTING")
                    .message("이미 변환 중입니다.").build();
        }

        if ("COMPLETED".equals(record.status)) {
            return ConversionStatusResponse.builder()
                    .fileId(fileId).status("COMPLETED")
                    .fragDownloadUrl("/api/ifc/" + fileId + "/frag")
                    .message("이미 변환 완료되었습니다.").build();
        }

        record.status = "CONVERTING";

        conversionService.convertAsync(fileId, record.ifcPath, getFragPath(fileId))
                .thenAccept(success -> {
                    if (success) {
                        record.status = "COMPLETED";
                        record.fragPath = getFragPath(fileId);
                        log.info("변환 완료: {}", fileId);
                    } else {
                        record.status = "FAILED";
                        log.error("변환 실패: {}", fileId);
                    }
                });

        return ConversionStatusResponse.builder()
                .fileId(fileId).status("CONVERTING")
                .message("변환이 시작되었습니다. /status로 진행 상태를 확인하세요.").build();
    }

    public ConversionStatusResponse getConversionStatus(String fileId) {
        FileRecord record = getRecord(fileId);

        ConversionStatusResponse.ConversionStatusResponseBuilder builder =
                ConversionStatusResponse.builder().fileId(fileId).status(record.status);

        if ("COMPLETED".equals(record.status)) {
            builder.fragDownloadUrl("/api/ifc/" + fileId + "/frag")
                    .message("변환 완료. .frag 파일을 다운로드할 수 있습니다.");
        } else if ("FAILED".equals(record.status)) {
            builder.message("변환에 실패했습니다.");
        } else {
            builder.message("변환 진행 중...");
        }
        return builder.build();
    }

    public Resource getFragFile(String fileId) {
        FileRecord record = getRecord(fileId);

        if (!"COMPLETED".equals(record.status)) {
            throw new RuntimeException("변환이 아직 완료되지 않았습니다. 상태: " + record.status);
        }

        // 분할 변환인 경우 첫 번째 .frag 반환
        if (record.fragFiles != null && !record.fragFiles.isEmpty()) {
            Path fragPath = Paths.get(record.fragFiles.get(0));
            if (!Files.exists(fragPath)) {
                throw new RuntimeException(".frag 파일을 찾을 수 없습니다: " + fragPath);
            }
            return new FileSystemResource(fragPath);
        }

        Path fragPath = Paths.get(record.fragPath);
        if (!Files.exists(fragPath)) {
            throw new RuntimeException(".frag 파일을 찾을 수 없습니다: " + fragPath);
        }
        return new FileSystemResource(fragPath);
    }

    public Resource getFragFileByIndex(String fileId, int chunkIndex) {
        FileRecord record = getRecord(fileId);

        if (!"COMPLETED".equals(record.status)) {
            throw new RuntimeException("변환이 아직 완료되지 않았습니다. 상태: " + record.status);
        }

        if (record.fragFiles == null || record.fragFiles.isEmpty()) {
            throw new RuntimeException("분할 변환 결과가 없습니다: " + fileId);
        }

        if (chunkIndex < 0 || chunkIndex >= record.fragFiles.size()) {
            throw new RuntimeException("청크 인덱스 범위 초과: " + chunkIndex
                    + " (전체: " + record.fragFiles.size() + ")");
        }

        Path fragPath = Paths.get(record.fragFiles.get(chunkIndex));
        if (!Files.exists(fragPath)) {
            throw new RuntimeException(".frag 파일을 찾을 수 없습니다: " + fragPath);
        }
        return new FileSystemResource(fragPath);
    }

    private FileRecord getRecord(String fileId) {
        FileRecord record = fileRecords.get(fileId);
        if (record == null) {
            throw new RuntimeException("파일을 찾을 수 없습니다: " + fileId);
        }
        return record;
    }

    private String getFragPath(String fileId) {
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
        java.util.List<String> fragFiles;  // 분할 변환 시 여러 .frag 경로
    }
}
