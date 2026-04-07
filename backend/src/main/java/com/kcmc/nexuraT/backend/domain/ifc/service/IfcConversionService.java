package com.kcmc.nexuraT.backend.domain.ifc.service;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Slf4j
@Service
public class IfcConversionService {

    @Value("${ifc.converter.url:http://localhost:3001}")
    private String converterBaseUrl;

    @Value("${ifc.converter.chunk-target-mb:800}")
    private int chunkTargetMb;

    private final RestTemplate restTemplate = new RestTemplate();

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ConversionResult {
        private boolean success;
        private String fragPath;
        private List<String> fragFiles;
        private String manifestPath;
        private Integer totalChunks;
        private String errorMessage;
    }

    @Async
    public CompletableFuture<ConversionResult> convertAsync(
            String fileId, String ifcPath, String fragPath) {

        try {
            Path resolvedIfcPath = Paths.get(ifcPath).toAbsolutePath().normalize();
            Path resolvedFragPath = Paths.get(fragPath).toAbsolutePath().normalize();

            Path outputDir = resolvedFragPath.getParent();
            Files.createDirectories(outputDir);

            String url = converterBaseUrl + "/convert";

            Map<String, Object> requestBody = new HashMap<>();
            requestBody.put("fileId", fileId);
            requestBody.put("ifcPath", resolvedIfcPath.toString());
            requestBody.put("fragPath", resolvedFragPath.toString());
            requestBody.put("chunkTargetMb", chunkTargetMb);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

            log.info("Node.js converter request: fileId={}, ifcPath={}, fragPath={}, chunkTargetMb={}",
                    fileId, resolvedIfcPath, resolvedFragPath, chunkTargetMb);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.POST, entity, Map.class);

            if (response.getStatusCode() == HttpStatus.OK) {
                Map body = response.getBody();
                boolean success = body != null && "COMPLETED".equals(String.valueOf(body.get("status")));

                ConversionResult result = ConversionResult.builder()
                        .success(success)
                        .fragPath(asString(body, "fragPath"))
                        .fragFiles(asStringList(body, "fragFiles"))
                        .manifestPath(asString(body, "manifestPath"))
                        .totalChunks(asInteger(body, "totalChunks"))
                        .errorMessage(asString(body, "message"))
                        .build();

                log.info("Conversion result: fileId={}, success={}, totalChunks={}",
                        fileId, result.isSuccess(), result.getTotalChunks());

                return CompletableFuture.completedFuture(result);
            }

            return CompletableFuture.completedFuture(
                    ConversionResult.builder()
                            .success(false)
                            .errorMessage("Converter returned a non-OK response.")
                            .build()
            );

        } catch (Exception e) {
            log.error("Conversion request failed: fileId={}", fileId, e);
            return CompletableFuture.completedFuture(
                    ConversionResult.builder()
                            .success(false)
                            .errorMessage(e.getMessage())
                            .build()
            );
        }
    }

    private String asString(Map body, String key) {
        if (body == null) {
            return null;
        }
        Object value = body.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private Integer asInteger(Map body, String key) {
        if (body == null) {
            return null;
        }
        Object value = body.get(key);
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value == null) {
            return null;
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private List<String> asStringList(Map body, String key) {
        if (body == null) {
            return Collections.emptyList();
        }

        Object value = body.get(key);
        if (!(value instanceof List<?> list)) {
            return Collections.emptyList();
        }

        return list.stream()
                .map(String::valueOf)
                .collect(Collectors.toList());
    }
}
