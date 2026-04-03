package com.kcmc.nexuraT.backend.domain.hello.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class controller {

    @GetMapping("/api/hello")
    public String hello() {
        return "hello";
    }
}
