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
    private String status;
    private String fragDownloadUrl;
    private String message;
    private Integer progressPercent;
    private java.util.List<String> fragDownloadUrls; // 분할 변환 시 여러 .frag URL
}
