package com.kcmc.nexuraT.backend.domain.ifc.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UploadResponse {

    private String fileId;
    private String originalName;
    private long fileSize;
    private String status;      // UPLOADED, CONVERTING, COMPLETED, FAILED
    private String message;
}
