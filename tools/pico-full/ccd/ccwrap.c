/* ccwrap.c -- native stand-in executable (clang.exe, clang++.exe, ld.lld.exe) for CMake/Ninja (pico2 P1-F2, from
   experiment E-CC-WASM-1). Runs: node --no-warnings <dir>\ccd-client.mjs <tool> <original arguments, unchanged>
   where <tool> is this executable's file name without ".exe". Built by tools/pico-full/build-ccd.ps1 with MSYS2 gcc.
   Development tool only. Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. */
#include <windows.h>
#include <wchar.h>

int wmain(void) {
  wchar_t self[MAX_PATH], dir[MAX_PATH], tool[MAX_PATH];
  GetModuleFileNameW(NULL, self, MAX_PATH);
  wcscpy(dir, self);
  wchar_t *slash = wcsrchr(dir, L'\\');
  wcscpy(tool, slash + 1);
  *slash = 0;
  size_t n = wcslen(tool);
  if (n > 4 && _wcsicmp(tool + n - 4, L".exe") == 0) tool[n - 4] = 0;

  /* Skip argv[0] in the raw command line (quoted or not), keep the rest byte for byte. */
  wchar_t *cl = GetCommandLineW();
  if (*cl == L'"') { cl++; while (*cl && *cl != L'"') cl++; if (*cl) cl++; }
  else { while (*cl && *cl != L' ' && *cl != L'\t') cl++; }

  wchar_t node[MAX_PATH] = L"node";
  GetEnvironmentVariableW(L"CCWRAP_NODE", node, MAX_PATH);
  size_t len = wcslen(node) + wcslen(dir) + wcslen(tool) + wcslen(cl) + 128;
  wchar_t *cmd = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, len * sizeof(wchar_t));
  swprintf(cmd, len, L"\"%ls\" --no-warnings \"%ls\\ccd-client.mjs\" %ls%ls", node, dir, tool, cl);

  STARTUPINFOW si = { sizeof si };
  PROCESS_INFORMATION pi;
  if (!CreateProcessW(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) return 127;
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1;
  GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}
