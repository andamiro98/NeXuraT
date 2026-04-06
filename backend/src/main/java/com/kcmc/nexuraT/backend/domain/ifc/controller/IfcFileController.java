package com.kcmc.nexuraT.backend.domain.ifc.controller;

import com.kcmc.nexuraT.backend.domain.ifc.dto.ConversionStatusResponse;
import com.kcmc.nexuraT.backend.domain.ifc.dto.UploadResponse;
import com.kcmc.nexuraT.backend.domain.ifc.service.IfcFileService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@RestController
@RequestMapping("/api/ifc")
@RequiredArgsConstructor
public class IfcFileController {

    private final IfcFileService ifcFileService;

    /**
     * IFC 파일 업로드 (스트리밍 저장 — 메모리에 전체를 올리지 않음)
     */
    @PostMapping("/upload")
    public ResponseEntity<UploadResponse> uploadIfcFile(
            @RequestParam("file") MultipartFile file) {

        UploadResponse response = ifcFileService.handleUpload(file);
        return ResponseEntity.ok(response);
    }

    /**
     * 변환 요청 (업로드된 IFC → .frag)
     */
    @PostMapping("/{fileId}/convert")
    public ResponseEntity<ConversionStatusResponse> requestConversion(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.requestConversion(fileId);
        return ResponseEntity.ok(response);
    }

    /**
     * 변환 상태 폴링
     */
    @GetMapping("/{fileId}/status")
    public ResponseEntity<ConversionStatusResponse> getConversionStatus(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.getConversionStatus(fileId);
        return ResponseEntity.ok(response);
    }

    /**
     * 변환 완료된 .frag 파일
     */
    @GetMapping(value = "/{fileId}/frag", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Resource> getFrag(@PathVariable String fileId) throws IOException {
        Path fragPath = Paths.get("C:/Users/KCMC_BIM/Desktop/dev/nexuraT/ifc-storage/converted", fileId + ".frag");

        if (!Files.exists(fragPath)) {
            return ResponseEntity.notFound().build();
        }

        Resource resource = new InputStreamResource(Files.newInputStream(fragPath));

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(Files.size(fragPath))
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + fragPath.getFileName() + "\"")
                .body(resource);
    }

    /**
     * 분할 변환 시 특정 청크 .frag 다운로드
     */
    @GetMapping("/{fileId}/frag/{chunkIndex}")
    public ResponseEntity<Resource> downloadChunkFragFile(
            @PathVariable String fileId,
            @PathVariable int chunkIndex) {

        Resource resource = ifcFileService.getFragFileByIndex(fileId, chunkIndex);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + fileId + "_" + chunkIndex + ".frag\"")
                .body(resource);
    }
}
