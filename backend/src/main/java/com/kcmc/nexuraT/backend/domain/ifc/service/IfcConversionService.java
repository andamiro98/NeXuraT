package com.kcmc.nexuraT.backend.domain.ifc.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/**
 * IFC → .frag 변환 서비스.
 *
 * 구조:
 *   Spring Boot → HTTP → Node.js 변환 서버 (localhost:3001)
 *
 * 추후 Electron 확장 시:
 *   converter.ts 의 convertIfcToFrag()를 직접 import하여 사용 (HTTP 불필요)
 */
@Slf4j
@Service
public class IfcConversionService {

    @Value("${ifc.converter.url:http://localhost:3001}")
    private String converterBaseUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @Async
    public CompletableFuture<Boolean> convertAsync(
            String fileId, String ifcPath, String fragPath) {

        try {
            Path resolvedIfcPath = Paths.get(ifcPath).toAbsolutePath().normalize();
            Path resolvedFragPath = Paths.get(fragPath).toAbsolutePath().normalize();

            Path outputDir = resolvedFragPath.getParent();
            Files.createDirectories(outputDir);

            String url = converterBaseUrl + "/convert";

            Map<String, String> requestBody = new HashMap<>();
            requestBody.put("fileId", fileId);
            requestBody.put("ifcPath", resolvedIfcPath.toString());
            requestBody.put("fragPath", resolvedFragPath.toString());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<Map<String, String>> entity = new HttpEntity<>(requestBody, headers);

            log.info("Node.js 변환 서버에 요청: fileId={}, ifcPath={}, fragPath={}",
                    fileId, resolvedIfcPath, resolvedFragPath);

            ResponseEntity<Map> response = restTemplate.exchange(
                    url, HttpMethod.POST, entity, Map.class);

            if (response.getStatusCode() == HttpStatus.OK) {
                Map body = response.getBody();
                boolean success = body != null && "COMPLETED".equals(body.get("status"));

                // 분할 변환인 경우 fragFiles 목록 저장
                if (body != null && body.containsKey("fragFiles")) {
                    List<String> fragFilesList = (List<String>) body.get("fragFiles");
                    if (fragFilesList != null && !fragFilesList.isEmpty()) {
                        log.info("분할 변환 결과: {}개 .frag 파일", fragFilesList.size());
                        // CompletableFuture에 fragFiles 정보를 전달하기 위해
                        // 별도 콜백에서 처리 (IfcFileService에서 참조)
                        return CompletableFuture.completedFuture(success);
                    }
                }

                log.info("변환 결과: fileId={}, success={}", fileId, success);
                return CompletableFuture.completedFuture(success);
            }

            return CompletableFuture.completedFuture(false);

        } catch (Exception e) {
            log.error("변환 요청 실패: fileId={}", fileId, e);
            return CompletableFuture.completedFuture(false);
        }
    }
}
