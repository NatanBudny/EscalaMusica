@echo off
rem askpass do git para a Casca (Windows).
rem
rem O git chama este script duas vezes ao autenticar por HTTPS: uma pedindo o
rem usuario ("Username for ...") e outra pedindo a senha ("Password for ...").
rem Para um token do GitHub, o usuario e "x-access-token" e a senha e o proprio
rem token, entregue so pela variavel de ambiente ESCALA_GIT_TOKEN.
rem
rem O token nunca aparece em argumento, URL, log nem arquivo do repositorio:
rem o git recebe o prompt como primeiro argumento (%~1) e le a resposta do stdout.
rem
rem Feature: melhoras-domingao (G. Instalador) — Requisito 31.5.

echo %~1 | find /i "Username" >nul
if %errorlevel%==0 (
  echo x-access-token
) else (
  echo %ESCALA_GIT_TOKEN%
)
