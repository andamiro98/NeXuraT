package com.kcmc.nexuraT.backend.domain.ifc.controller;

import com.kcmc.nexuraT.backend.domain.ifc.dto.ConversionStatusResponse;
import com.kcmc.nexuraT.backend.domain.ifc.dto.UploadResponse;
import com.kcmc.nexuraT.backend.domain.ifc.service.IfcFileService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

@RestController
@RequestMapping("/api/ifc")
@RequiredArgsConstructor
public class IfcFileController {

    private final IfcFileService ifcFileService;

    @PostMapping("/upload")
    public ResponseEntity<UploadResponse> uploadIfcFile(
            @RequestParam("file") MultipartFile file) {

        UploadResponse response = ifcFileService.handleUpload(file);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/{fileId}/convert")
    public ResponseEntity<ConversionStatusResponse> requestConversion(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.requestConversion(fileId);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{fileId}/status")
    public ResponseEntity<ConversionStatusResponse> getConversionStatus(
            @PathVariable String fileId) {

        ConversionStatusResponse response = ifcFileService.getConversionStatus(fileId);
        return ResponseEntity.ok(response);
    }

    @GetMapping(value = "/{fileId}/frag", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Resource> getFrag(@PathVariable String fileId) throws IOException {
        Resource resource = ifcFileService.getFragFile(fileId);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(resource.contentLength())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + resource.getFilename() + "\"")
                .body(resource);
    }

    @GetMapping(value = "/{fileId}/frag/{chunkIndex}", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Resource> downloadChunkFragFile(
            @PathVariable String fileId,
            @PathVariable int chunkIndex) throws IOException {

        Resource resource = ifcFileService.getFragFileByIndex(fileId, chunkIndex);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(resource.contentLength())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + resource.getFilename() + "\"")
                .body(resource);
    }

    @GetMapping(value = "/{fileId}/manifest", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Resource> getManifest(@PathVariable String fileId) throws IOException {
        Resource resource = ifcFileService.getManifestFile(fileId);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .contentLength(resource.contentLength())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + resource.getFilename() + "\"")
                .body(resource);
    }
}
