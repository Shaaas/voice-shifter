pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FRAME_SIZE);
    let ifft = planner.plan_fft_inverse(FRAME_SIZE);

    let num_frames = (input.len().saturating_sub(FRAME_SIZE)) / HOP_SIZE + 1;
    let output_len = input.len();
    let mut output_accum = vec![0.0f32; output_len + FRAME_SIZE];
    let mut window_accum = vec![0.0f32; output_len + FRAME_SIZE];

    // Hann window
    let window: Vec<f32> = (0..FRAME_SIZE)
        .map(|i| {
            0.5 * (1.0
                - (2.0 * std::f32::consts::PI * i as f32
                    / (FRAME_SIZE - 1) as f32)
                    .cos())
        })
        .collect();

    let omega: Vec<f32> = (0..FRAME_SIZE)
        .map(|k| {
            2.0 * std::f32::consts::PI * k as f32 * HOP_SIZE as f32
                / FRAME_SIZE as f32
        })
        .collect();

    for frame_idx in 0..num_frames {
        let in_offset = frame_idx * HOP_SIZE;
        let out_offset = (frame_idx as f32 * HOP_SIZE as f32 / self.pitch_scale) as usize;

        // Apply window
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

        fft.process(&mut spectrum);

        let mut shifted: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FRAME_SIZE];

        for k in 0..FRAME_SIZE / 2 {
            let magnitude = spectrum[k].norm();
            let phase = spectrum[k].arg();

            let delta_phase = phase - self.last_phase[k] - omega[k];

            // Wrap phase to [-pi, pi]
            let mut delta_wrapped = delta_phase
                % (2.0 * std::f32::consts::PI);
            if delta_wrapped > std::f32::consts::PI {
                delta_wrapped -= 2.0 * std::f32::consts::PI;
            } else if delta_wrapped < -std::f32::consts::PI {
                delta_wrapped += 2.0 * std::f32::consts::PI;
            }

            self.last_phase[k] = phase;
            self.phase_accum[k] += (omega[k] + delta_wrapped) * self.pitch_scale;

            // Map to target bin
            let target_bin = ((k as f32 * self.pitch_scale) as usize)
                .min(FRAME_SIZE / 2 - 1);

            shifted[target_bin] += Complex::new(
                magnitude * self.phase_accum[k].cos(),
                magnitude * self.phase_accum[k].sin(),
            );
        }

        ifft.process(&mut shifted);

        // Overlap-add with window normalization
        for i in 0..FRAME_SIZE {
            if out_offset + i < output_accum.len() {
                output_accum[out_offset + i] += shifted[i].re * window[i];
                window_accum[out_offset + i] += window[i] * window[i];
            }
        }
    }

    // Normalize by window accumulation to remove artifacts
    let mut output = vec![0.0f32; output_len];
    for i in 0..output_len {
        if window_accum[i] > 1e-8 {
            output[i] = (output_accum[i] / window_accum[i])
                .max(-1.0)
                .min(1.0);
        }
    }

    output
}