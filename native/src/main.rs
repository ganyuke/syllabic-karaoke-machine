mod app;
mod audio;
mod lyrics;
mod lyrics_view;
mod model;
mod project;
mod theme;
mod timeline;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Wgpu,
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Syllable Karaoke Studio")
            .with_inner_size([1360.0, 860.0])
            .with_min_inner_size([900.0, 560.0]),
        vsync: true,
        ..Default::default()
    };
    eframe::run_native(
        "Syllable Karaoke Studio",
        options,
        Box::new(|cc| Ok(Box::new(app::App::new(cc)))),
    )
}
