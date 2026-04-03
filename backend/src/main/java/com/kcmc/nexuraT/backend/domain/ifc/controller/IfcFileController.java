package com.kcmc.nexuraT.backend.domain.ifc.controller;

import com.kcmc.nexuraT.backend.domain.ifc.dto.ConversionStatusResponse;
import com.kcmc.nexuraT.backend.domain.ifc.dto.UploadResponse;
import com.kcmc.nexuraT.backend.domain.ifc.service.IfcFileService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/ifc")
@RequiredArgsConstructor
public class IfcFileController {

    private final IfcFileService ifcFileService;

    /**
     * 1단계: IFC 파일 업로드 (스트리밍 저장 — 메모리에 전체를 올리지 않음)
     */
    @PostMapping("/upload")
    public ResponseEntity<UploadResponse> uploadIfcFile(
            @RequestParam("file") MultipartFile file) {

        UploadResponse response = ifcFileService.handleUpload(file);
        return ResponseEntity.ok(response);
    }

    /**
     * 2단계: 변환 요청 (업로드된 IFC → .frag)
     */
    @PostMapping("/{fileId}/convert")
    public ResponseEntity<ConversionStatusResponse> requestConversion(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.requestConversion(fileId);
        return ResponseEntity.ok(response);
    }

    /**
     * 3단계: 변환 상태 폴링
     */
    @GetMapping("/{fileId}/status")
    public ResponseEntity<ConversionStatusResponse> getConversionStatus(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.getConversionStatus(fileId);
        return ResponseEntity.ok(response);
    }

    /**
     * 4단계: 변환 완료된 .frag 파일 다운로드
     */
    @GetMapping("/{fileId}/frag")
    public ResponseEntity<Resource> downloadFragFile(
            @PathVariable String fileId) {

        Resource resource = ifcFileService.getFragFile(fileId);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + fileId + ".frag\"")
                .body(resource);
    }

    /**
     * 4-1단계: 분할 변환 시 특정 청크 .frag 다운로드
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
