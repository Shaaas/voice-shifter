use wasm_bindgen::prelude::*;
use rustfft::{FftPlanner, num_complex::Complex};

const FRAME_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;

#[wasm_bindgen]
pub struct VoiceShifter {
    sample_rate: f32,
    pitch_scale: f32,
    last_phase: Vec<f32>,
    phase_accum: Vec<f32>,
}

#[wasm_bindgen]
impl VoiceShifter {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> VoiceShifter {
        VoiceShifter {
            sample_rate,
            pitch_scale: 1.0,
            last_phase: vec![0.0; FRAME_SIZE],
            phase_accum: vec![0.0; FRAME_SIZE],
        }
    }

    pub fn set_pitch_semitones(&mut self, semitones: f32) {
        self.pitch_scale = 2.0_f32.powf(semitones / 12.0);
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FRAME_SIZE);
        let ifft = planner.plan_fft_inverse(FRAME_SIZE);

        let num_frames = (input.len().saturating_sub(FRAME_SIZE)) / HOP_SIZE + 1;
        let output_len = input.len();
        let mut output = vec![0.0f32; output_len];
        let mut output_accum = vec![0.0f32; output_len + FRAME_SIZE];

        // Hann window for smooth frame edges
        let window: Vec<f32> = (0..FRAME_SIZE)
            .map(|i| {
                0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32
                    / (FRAME_SIZE - 1) as f32).cos())
            })
            .collect();

        let omega: Vec<f32> = (0..FRAME_SIZE)
            .map(|k| {
                2.0 * std::f32::consts::PI * k as f32 * HOP_SIZE as f32 / FRAME_SIZE as f32
            })
            .collect();

        for frame_idx in 0..num_frames {
            let in_offset = frame_idx * HOP_SIZE;
            let out_offset = (frame_idx as f32 * HOP_SIZE as f32 / self.pitch_scale) as usize;

            // Apply window and convert to complex
            let mut spectrum: Vec<Complex<f32>> = (0..FRAME_SIZE)
                .map(|i| {
                    let sample = if in_offset + i < input.len() {
                        input[in_offset + i] * window[i]
                    } else {
                        0.0
                    };
                    Complex::new(sample, 0.0)
                })
                .collect();

            // Forward FFT
            fft.process(&mut spectrum);

            // Phase vocoder — shift each bin's phase
            let mut shifted: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FRAME_SIZE];
            for k in 0..FRAME_SIZE {
                let magnitude = spectrum[k].norm();
                let phase = spectrum[k].arg();

                // True frequency deviation from expected
                let delta_phase = phase - self.last_phase[k] - omega[k];

                // Wrap to [-pi, pi]
                let delta_wrapped = delta_phase
                    - 2.0 * std::f32::consts::PI
                        * (delta_phase / (2.0 * std::f32::consts::PI)).round();

                // Accumulate phase scaled by pitch ratio
                self.last_phase[k] = phase;
                self.phase_accum[k] += (omega[k] + delta_wrapped) * self.pitch_scale;

                // Reconstruct with new phase
                let target_bin = ((k as f32 * self.pitch_scale) as usize).min(FRAME_SIZE - 1);
                shifted[target_bin] += Complex::new(
                    magnitude * self.phase_accum[k].cos(),
                    magnitude * self.phase_accum[k].sin(),
                );
            }

            // Inverse FFT
            ifft.process(&mut shifted);

            // Overlap-add into output
            let scale = 1.0 / (FRAME_SIZE as f32 * 0.5);
            for i in 0..FRAME_SIZE {
                if out_offset + i < output_accum.len() {
                    output_accum[out_offset + i] +=
                        shifted[i].re * window[i] * scale;
                }
            }
        }

        // Copy to output
        for i in 0..output_len {
            output[i] = output_accum[i].max(-1.0).min(1.0);
        }

        output
    }
}