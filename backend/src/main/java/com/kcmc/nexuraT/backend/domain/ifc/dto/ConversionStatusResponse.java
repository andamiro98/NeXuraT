package com.kcmc.nexuraT.backend.domain.ifc.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConversionStatusResponse {

    private String fileId;
    private String status;          // UPLOADED | CONVERTING | COMPLETED | FAILED
    private String fragDownloadUrl; // 변환 완료 시 다운로드 경로
    private String message;
    private Integer progressPercent;
}
