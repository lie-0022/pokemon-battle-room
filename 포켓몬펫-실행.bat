@echo off
chcp 65001 >nul
title 포켓몬 데스크톱 펫
cd /d "%~dp0"
echo 포켓몬 데스크톱 펫을 실행합니다...
echo (이 창을 닫으면 펫도 종료됩니다. 트레이 아이콘 우클릭 - 종료 로도 끌 수 있어요.)
call npm start
