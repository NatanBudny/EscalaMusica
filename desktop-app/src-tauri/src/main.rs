// Impede que uma janela de console extra abra no Windows em builds de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gestao_leiga_core::run()
}
