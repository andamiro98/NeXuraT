package com.kcmc.nexuraT.backend.domain.ifc.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConversionStatusResponse {

    private String fileId;
    private String status;
    private String fragDownloadUrl;
    private List<String> fragDownloadUrls;
    private String manifestUrl;
    private Integer totalChunks;
    private String message;
    private Integer progressPercent;
}
