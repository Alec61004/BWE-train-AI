const CUTOFF_ANALYSIS_SECONDS = 20;
const API_BASE_URL = String(window.BWE_API_BASE_URL || "").trim().replace(/\/+$/, "");

const state = {
  mode: "restore",
  file: null,
  inputBuffer: null,
  inputUrl: null,
  outputUrl: null,
  benchmarkUrls: [],
  abortController: null,
};

const els = {
  modeInputs: document.querySelectorAll("input[name='mode']"),
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  uploadSubtitle: document.querySelector("#uploadSubtitle"),
  fileCard: document.querySelector("#fileCard"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  clearFileButton: document.querySelector("#clearFileButton"),
  inputAudioRow: document.querySelector("#inputAudioRow"),
  inputAudioLabel: document.querySelector("#inputAudioLabel"),
  inputPlayer: document.querySelector("#inputPlayer"),
  settingsTitle: document.querySelector("#settings-title"),
  settingsSubtitle: document.querySelector("#settingsSubtitle"),
  apiEndpoint: document.querySelector("#apiEndpoint"),
  cutoffLegend: document.querySelector("#cutoffLegend"),
  autoCutoffOption: document.querySelector("#autoCutoffOption"),
  cutoffHint: document.querySelector("#cutoffHint"),
  restoreButton: document.querySelector("#restoreButton"),
  restoreButtonLabel: document.querySelector("#restoreButtonLabel"),
  runtimeStatus: document.querySelector("#runtimeStatus"),
  progressTitle: document.querySelector("#progressTitle"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
  chunkList: document.querySelector("#chunkList"),
  resultPanel: document.querySelector("#resultPanel"),
  resultEyebrow: document.querySelector("#resultEyebrow"),
  resultTitle: document.querySelector("#result-title"),
  restoreResult: document.querySelector("#restoreResult"),
  outputPlayer: document.querySelector("#outputPlayer"),
  downloadLink: document.querySelector("#downloadLink"),
  benchmarkResult: document.querySelector("#benchmarkResult"),
  highImprovement: document.querySelector("#highImprovement"),
  fullImprovement: document.querySelector("#fullImprovement"),
  benchmarkDuration: document.querySelector("#benchmarkDuration"),
  referencePlayer: document.querySelector("#referencePlayer"),
  lowpassPlayer: document.querySelector("#lowpassPlayer"),
  benchmarkRestoredPlayer: document.querySelector("#benchmarkRestoredPlayer"),
  lowpassAudioTitle: document.querySelector("#lowpassAudioTitle"),
  baselineHighLsd: document.querySelector("#baselineHighLsd"),
  restoredHighLsd: document.querySelector("#restoredHighLsd"),
  baselineFullLsd: document.querySelector("#baselineFullLsd"),
  restoredFullLsd: document.querySelector("#restoredFullLsd"),
  baselineLowLsd: document.querySelector("#baselineLowLsd"),
  restoredLowLsd: document.querySelector("#restoredLowLsd"),
  baselineSnr: document.querySelector("#baselineSnr"),
  restoredSnr: document.querySelector("#restoredSnr"),
  validationRow: document.querySelector("#validationRow"),
  benchmarkMeta: document.querySelector("#benchmarkMeta"),
  benchmarkDownloadLink: document.querySelector("#benchmarkDownloadLink"),
};

if (API_BASE_URL) {
  els.apiEndpoint.value = `${API_BASE_URL}/restore`;
}

els.fileInput.addEventListener("change", () => {
  const [file] = els.fileInput.files;
  if (file) loadFile(file);
});

els.modeInputs.forEach((input) => {
  input.addEventListener("change", () => setMode(input.value));
});

els.clearFileButton.addEventListener("click", resetFile);
els.restoreButton.addEventListener("click", processAudio);
els.apiEndpoint.addEventListener("input", updateReadyState);

["dragenter", "dragover"].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragging");
  });
});

els.dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

function setMode(mode) {
  if (!["restore", "benchmark"].includes(mode) || state.mode === mode) return;
  state.mode = mode;
  resetFile();

  const isBenchmark = mode === "benchmark";
  els.uploadSubtitle.textContent = isBenchmark
    ? "Bản gốc full-band dùng làm tham chiếu"
    : "File lowpass 4kHz hoặc 8kHz";
  els.inputAudioLabel.textContent = isBenchmark
    ? "Nghe bản gốc full-band"
    : "Nghe bản gốc lowpass";
  els.settingsTitle.textContent = isBenchmark ? "Thiết lập kiểm thử" : "Thiết lập phục hồi";
  els.settingsSubtitle.textContent = isBenchmark
    ? "Chọn mức cắt để mô phỏng đầu vào"
    : "Chọn dải tần của file đầu vào";
  els.cutoffLegend.textContent = isBenchmark ? "Mức cắt mô phỏng" : "Dải tần bị cắt";
  els.restoreButtonLabel.textContent = isBenchmark ? "Chạy kiểm thử model" : "Phục hồi âm thanh";
  els.autoCutoffOption.hidden = isBenchmark;

  if (isBenchmark) {
    document.querySelector("input[name='cutoff'][value='4000']").checked = true;
    els.cutoffHint.innerHTML =
      '<i data-lucide="flask-conical" aria-hidden="true"></i> Hệ thống tạo bản lowpass giống dữ liệu huấn luyện, phục hồi rồi so với bản gốc.';
  } else {
    document.querySelector("input[name='cutoff'][value='auto']").checked = true;
    els.cutoffHint.innerHTML =
      '<i data-lucide="sparkles" aria-hidden="true"></i> Hệ thống sẽ tự phân tích phổ âm thanh và chọn model phù hợp.';
  }
  refreshIcons();
}

async function loadFile(file) {
  cleanupOutput();
  state.file = file;
  setStatus("Đang giải mã");
  setProgress(0, "Đang đọc thông tin file", "0%");

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.inputBuffer = await decodeAudioData(arrayBuffer);

    if (state.inputUrl) URL.revokeObjectURL(state.inputUrl);
    state.inputUrl = URL.createObjectURL(file);
    els.inputPlayer.src = state.inputUrl;
    els.inputAudioRow.hidden = false;

    els.fileName.textContent = file.name;
    els.fileMeta.textContent = [
      formatBytes(file.size),
      formatDuration(state.inputBuffer.duration),
      `${state.inputBuffer.numberOfChannels} kênh`,
      formatSampleRate(state.inputBuffer.sampleRate),
    ].join(" · ");
    els.fileCard.hidden = false;

    renderJobStatus("ready", "Sẵn sàng");
    const readyText = state.mode === "benchmark"
      ? "Bản gốc đã sẵn sàng để kiểm thử"
      : "File đã sẵn sàng để phục hồi";
    setProgress(0, readyText, "0%");
    setStatus("Sẵn sàng");
  } catch (error) {
    console.error(error);
    resetFile();
    setStatus("Lỗi file");
    setProgress(0, "Không giải mã được file audio", "!");
    alert("Không giải mã được file audio này. Hãy thử WAV, MP3, FLAC, M4A hoặc OGG khác.");
  }

  updateReadyState();
}

async function processAudio() {
  if (state.mode === "benchmark") {
    await runBenchmark();
    return;
  }
  await restoreAudio();
}

async function restoreAudio() {
  const endpoint = normalizeEndpoint(els.apiEndpoint.value.trim());
  if (!endpoint || !state.file || !state.inputBuffer) return;

  prepareRequest();
  setProgress(5, "Đang nhận diện dải tần", "5%");

  try {
    const cutoffHz = await readCutoffHz(state.inputBuffer);
    els.cutoffHint.textContent = `Đang dùng cấu hình ${cutoffHz / 1000}kHz cho lần phục hồi này.`;
    renderJobStatus("uploading", "Đang gửi");
    setProgress(12, "Đang tải bài hát lên máy chủ", "12%");

    const job = await submitRestoreJob({
      restoreEndpoint: endpoint,
      file: state.file,
      cutoffHz,
      signal: state.abortController.signal,
    });
    let outputBlob;
    let chunkCount;
    let elapsed;

    if (job.legacyResponse) {
      outputBlob = await readAudioResponse(job.legacyResponse);
      chunkCount = job.legacyResponse.headers.get("X-BWE-Chunks");
      elapsed = Number(job.legacyResponse.headers.get("X-Processing-Seconds"));
    } else {
      const jobResult = await waitForRestoreJob({
        restoreEndpoint: endpoint,
        statusPath: job.status_path,
        signal: state.abortController.signal,
      });
      setProgress(96, "Đang tải bản WAV hoàn chỉnh", "96%");
      const downloadResponse = await fetch(
        resolveApiPath(endpoint, job.download_path),
        { signal: state.abortController.signal },
      );
      outputBlob = await readAudioResponse(downloadResponse);
      chunkCount = jobResult.chunk_count;
      elapsed = Number(jobResult.processing_seconds);
    }

    setProcessingState(false);
    state.outputUrl = URL.createObjectURL(outputBlob);
    els.outputPlayer.src = state.outputUrl;
    els.downloadLink.href = state.outputUrl;
    els.downloadLink.download = buildOutputName(state.file.name);
    showRestoreResult();

    const completionText = Number.isFinite(elapsed) && elapsed > 0
      ? `Hoàn tất trong ${formatElapsed(elapsed)}`
      : "Đã phục hồi và ghép file hoàn chỉnh";

    renderJobStatus("done", chunkCount ? `${chunkCount} đoạn · Xong` : "Xong");
    finishRequest(completionText);
  } catch (error) {
    handleRequestError(error);
  } finally {
    state.abortController = null;
    updateReadyState();
  }
}

async function runBenchmark() {
  const restoreEndpoint = normalizeEndpoint(els.apiEndpoint.value.trim());
  if (!restoreEndpoint || !state.file || !state.inputBuffer) return;

  prepareRequest();
  renderJobStatus("uploading", "Đang gửi");
  setProgress(12, "Đang gửi bản gốc để tạo phép thử", "12%");

  try {
    const cutoffHz = Number(document.querySelector("input[name='cutoff']:checked").value);
    const response = await sendAudioFile({
      endpoint: getBenchmarkEndpoint(restoreEndpoint),
      file: state.file,
      cutoffHz,
      signal: state.abortController.signal,
      progressText: "GPU đang tạo lowpass, phục hồi và tính điểm",
    });
    const payload = await readJsonResponse(response);
    setProcessingState(false);
    showBenchmarkResult(payload);
    renderJobStatus("done", `${payload.chunk_count} đoạn · Xong`);
    finishRequest(`Hoàn tất kiểm thử trong ${formatElapsed(payload.processing_seconds)}`);
  } catch (error) {
    handleRequestError(error);
  } finally {
    state.abortController = null;
    updateReadyState();
  }
}

function prepareRequest() {
  cleanupOutput();
  state.abortController = new AbortController();
  updateReadyState();
  setStatus("Đang xử lý");
  renderJobStatus("uploading", "Chuẩn bị");
  setProgress(5, "Đang chuẩn bị âm thanh", "5%");
}

function finishRequest(completionText) {
  setStatus("Hoàn tất");
  setProgress(100, completionText, "100%");
  els.resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function handleRequestError(error) {
  console.error(error);
  setProcessingState(false);
  if (error.name === "AbortError" && !state.file) return;
  setStatus("Có lỗi");
  setProgress(0, getErrorMessage(error), "!");
  renderJobStatus("error", "Lỗi");
}

async function submitRestoreJob({ restoreEndpoint, file, cutoffHz, signal }) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("cutoff_hz", String(cutoffHz));

  setProcessingState(true);
  setProgress(18, "Đang tải bài hát lên máy chủ", "18%");
  renderJobStatus("uploading", "Đang tải lên");

  const response = await fetch(getRestoreJobEndpoint(restoreEndpoint), {
    method: "POST",
    body: form,
    signal,
  });
  if (response.status === 404) {
    const legacyResponse = await sendAudioFile({
      endpoint: restoreEndpoint,
      file,
      cutoffHz,
      signal,
    });
    return { legacyResponse };
  }
  return readJsonResponse(response);
}

async function waitForRestoreJob({ restoreEndpoint, statusPath, signal }) {
  const statusUrl = resolveApiPath(restoreEndpoint, statusPath);

  while (true) {
    const response = await fetch(statusUrl, {
      method: "GET",
      cache: "no-store",
      signal,
    });
    const job = await readJsonResponse(response);

    if (job.status === "done") return job;
    if (job.status === "error") {
      throw new Error(job.error || "Máy chủ không xử lý được bài hát.");
    }

    if (job.status === "processing") {
      const current = Number(job.progress_current) || 0;
      const total = Number(job.progress_total) || 0;
      const ratio = total > 0 ? current / total : 0;
      const percent = Math.min(94, Math.round(28 + ratio * 66));
      const detail = total > 0
        ? `Đoạn ${Math.min(current + 1, total)}/${total}`
        : "Đang chuẩn bị model";
      setProgress(percent, "GPU đang phục hồi bài hát", `${percent}%`);
      renderJobStatus("uploading", detail);
    } else {
      setProgress(25, "Đang chờ lượt xử lý trên GPU", "25%");
      renderJobStatus("uploading", "Trong hàng đợi");
    }

    await abortableDelay(1500, signal);
  }
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function sendAudioFile({
  endpoint,
  file,
  cutoffHz,
  signal,
  progressText = "GPU đang phục hồi toàn bộ bài hát",
}) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("cutoff_hz", String(cutoffHz));

  const request = fetch(endpoint, {
    method: "POST",
    body: form,
    signal,
  });

  setProcessingState(true);
  setProgress(20, progressText, "Đang chạy");
  renderJobStatus("uploading", "GPU xử lý");
  return request;
}

async function readAudioResponse(response) {
  await throwResponseError(response);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return decodeJsonAudioPayload(payload);
  }
  return response.blob();
}

async function readJsonResponse(response) {
  await throwResponseError(response);
  return response.json();
}

async function throwResponseError(response) {
  if (response.ok) return;
  const contentType = response.headers.get("content-type") || "";
  let detail = "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    detail = payload.error || payload.message || "";
  } else {
    detail = await response.text().catch(() => "");
  }
  throw new Error(`Máy chủ trả lỗi HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}

function showRestoreResult() {
  els.resultEyebrow.textContent = "Hoàn tất phục hồi";
  els.resultTitle.textContent = "Bản full-band 44.1kHz đã sẵn sàng";
  els.restoreResult.hidden = false;
  els.benchmarkResult.hidden = true;
  els.resultPanel.hidden = false;
}

function showBenchmarkResult(payload) {
  const metrics = payload.metrics;
  const baseline = metrics.baseline;
  const restored = metrics.restored;
  const validation = metrics.validation;

  const referenceBlob = base64ToAudioBlob(payload.audio.reference_base64);
  const lowpassBlob = base64ToAudioBlob(payload.audio.lowpass_base64);
  const restoredBlob = base64ToAudioBlob(payload.audio.restored_base64);
  state.benchmarkUrls = [referenceBlob, lowpassBlob, restoredBlob].map(URL.createObjectURL);

  els.referencePlayer.src = state.benchmarkUrls[0];
  els.lowpassPlayer.src = state.benchmarkUrls[1];
  els.benchmarkRestoredPlayer.src = state.benchmarkUrls[2];
  els.benchmarkDownloadLink.href = state.benchmarkUrls[2];
  els.benchmarkDownloadLink.download = buildBenchmarkOutputName(state.file.name, payload.cutoff_hz);

  els.highImprovement.textContent = formatPercent(metrics.improvement.high_percent);
  els.fullImprovement.textContent = formatPercent(metrics.improvement.full_percent);
  els.benchmarkDuration.textContent = formatDuration(payload.duration_seconds);
  els.lowpassAudioTitle.textContent = `Lowpass mô phỏng ${payload.cutoff_hz / 1000}kHz`;
  els.baselineHighLsd.textContent = formatMetric(baseline.lsd_high);
  els.restoredHighLsd.textContent = formatMetric(restored.lsd_high);
  els.baselineFullLsd.textContent = formatMetric(baseline.lsd_full);
  els.restoredFullLsd.textContent = formatMetric(restored.lsd_full);
  els.baselineLowLsd.textContent = formatMetric(baseline.lsd_low);
  els.restoredLowLsd.textContent = formatMetric(restored.lsd_low);
  els.baselineSnr.textContent = `${formatMetric(baseline.snr)} dB`;
  els.restoredSnr.textContent = `${formatMetric(restored.snr)} dB`;
  els.benchmarkMeta.textContent = [
    `${payload.sample_rate / 1000}kHz`,
    payload.device,
    payload.amp ? "FP16" : "FP32",
    formatElapsed(payload.processing_seconds),
  ].join(" · ");

  renderValidation([
    {
      passed: validation.highband_improved,
      label: validation.highband_improved ? "Dải cao được cải thiện" : "Dải cao chưa cải thiện",
    },
    {
      passed: validation.lowband_preserved,
      label: validation.lowband_preserved ? "Dải thấp được giữ ổn định" : "Dải thấp thay đổi đáng kể",
    },
    {
      passed: validation.no_clipping,
      label: validation.no_clipping ? "Không phát hiện clipping" : "Có mẫu bị clipping",
    },
  ]);

  els.resultEyebrow.textContent = "Hoàn tất kiểm thử";
  els.resultTitle.textContent = validation.highband_improved
    ? "Model đã phục hồi thêm thông tin dải cao"
    : "Kết quả chưa cho thấy cải thiện dải cao";
  els.restoreResult.hidden = true;
  els.benchmarkResult.hidden = false;
  els.resultPanel.hidden = false;
}

function renderValidation(items) {
  els.validationRow.innerHTML = "";
  items.forEach(({ passed, label }) => {
    const badge = document.createElement("span");
    badge.className = `validation-badge${passed ? "" : " failed"}`;
    badge.innerHTML = `<i data-lucide="${passed ? "circle-check" : "circle-alert"}" aria-hidden="true"></i><span></span>`;
    badge.querySelector("span").textContent = label;
    els.validationRow.appendChild(badge);
  });
  refreshIcons();
}

function decodeJsonAudioPayload(payload) {
  const base64 = payload.audio_base64 || payload.wav_base64 || payload.file_base64;
  if (!base64) throw new Error("Phản hồi JSON không có dữ liệu audio.");
  return base64ToAudioBlob(base64);
}

function base64ToAudioBlob(base64) {
  const clean = base64.includes(",") ? base64.split(",").pop() : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

async function decodeAudioData(arrayBuffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  try {
    return await context.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await context.close();
  }
}

function renderJobStatus(className, label) {
  els.chunkList.innerHTML = "";
  const item = document.createElement("li");
  item.className = className;
  const name = state.mode === "benchmark" ? "Đoạn kiểm thử" : "Toàn bộ bài hát";
  item.innerHTML = `<span>${name}</span><strong>${label}</strong>`;
  els.chunkList.appendChild(item);
}

function resetFile() {
  if (state.abortController) state.abortController.abort();
  cleanupOutput();
  if (state.inputUrl) URL.revokeObjectURL(state.inputUrl);
  state.file = null;
  state.inputBuffer = null;
  state.inputUrl = null;
  state.abortController = null;
  els.fileInput.value = "";
  els.inputPlayer.removeAttribute("src");
  els.inputAudioRow.hidden = true;
  els.fileCard.hidden = true;
  els.chunkList.innerHTML = "";
  setProcessingState(false);
  setProgress(0, "Chưa có file", "0%");
  setStatus("Sẵn sàng");
  updateReadyState();
}

function cleanupOutput() {
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  state.outputUrl = null;
  state.benchmarkUrls.forEach((url) => URL.revokeObjectURL(url));
  state.benchmarkUrls = [];

  [
    els.outputPlayer,
    els.referencePlayer,
    els.lowpassPlayer,
    els.benchmarkRestoredPlayer,
  ].forEach((player) => {
    player.pause();
    player.removeAttribute("src");
  });
  els.downloadLink.removeAttribute("href");
  els.benchmarkDownloadLink.removeAttribute("href");
  els.restoreResult.hidden = true;
  els.benchmarkResult.hidden = true;
  els.resultPanel.hidden = true;
}

function updateReadyState() {
  els.restoreButton.disabled =
    !state.file ||
    !state.inputBuffer ||
    !els.apiEndpoint.value.trim() ||
    Boolean(state.abortController);
}

function normalizeEndpoint(endpoint) {
  if (endpoint.startsWith("/")) return `${window.location.origin}${endpoint}`;
  return endpoint;
}

function getBenchmarkEndpoint(restoreEndpoint) {
  const url = new URL(restoreEndpoint, window.location.origin);
  url.pathname = url.pathname.replace(/\/restore\/?$/, "/benchmark");
  if (!url.pathname.endsWith("/benchmark")) url.pathname = "/benchmark";
  return url.toString();
}

function getRestoreJobEndpoint(restoreEndpoint) {
  const url = new URL(restoreEndpoint, window.location.origin);
  url.pathname = url.pathname.replace(/\/restore\/?$/, "/jobs/restore");
  if (!url.pathname.endsWith("/jobs/restore")) url.pathname = "/jobs/restore";
  return url.toString();
}

function resolveApiPath(restoreEndpoint, path) {
  return new URL(path, restoreEndpoint).toString();
}

function setStatus(text) {
  const statusText = els.runtimeStatus.querySelector("span:last-child");
  if (statusText) statusText.textContent = text;
  else els.runtimeStatus.textContent = text;

  if (["Đang giải mã", "Đang xử lý"].includes(text)) {
    els.runtimeStatus.dataset.state = "working";
  } else if (text === "Hoàn tất") {
    els.runtimeStatus.dataset.state = "complete";
  } else if (text.includes("Lỗi") || text === "Có lỗi") {
    els.runtimeStatus.dataset.state = "error";
  } else {
    els.runtimeStatus.dataset.state = "ready";
  }
}

function setProgress(percent, title, label) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  els.progressBar.style.width = `${safePercent}%`;
  els.progressBar.parentElement.setAttribute("aria-valuenow", String(safePercent));
  els.progressTitle.textContent = title;
  els.progressText.textContent = label;
}

function setProcessingState(processing) {
  els.progressBar.parentElement.classList.toggle("processing", processing);
  els.progressBar.parentElement.setAttribute("aria-busy", String(processing));
}

async function readCutoffHz(buffer) {
  const selected = document.querySelector("input[name='cutoff']:checked").value;
  if (selected !== "auto") return Number(selected);

  const estimate = await estimateLowpassCutoff(buffer);
  els.cutoffHint.textContent =
    `Tự động nhận diện: ${estimate.cutoffHz / 1000}kHz (${estimate.reason}).`;
  return estimate.cutoffHz;
}

async function estimateLowpassCutoff(buffer) {
  const analysisBuffer = sliceAudioBuffer(
    buffer,
    Math.min(buffer.duration, CUTOFF_ANALYSIS_SECONDS),
  );
  const mono = mixToMono(analysisBuffer);
  const low = rms(await filterBuffer(mono, "lowpass", 4000));
  const below8 = rms(await filterBuffer(mono, "lowpass", 8000));
  const band4to8 = Math.sqrt(Math.max(0, below8 * below8 - low * low));
  const ratioDb = 20 * Math.log10((band4to8 + 1e-8) / (low + 1e-8));

  if (ratioDb < -28) {
    return {
      cutoffHz: 4000,
      reason: `vùng 4–8kHz rất yếu, ${ratioDb.toFixed(1)}dB`,
    };
  }
  return {
    cutoffHz: 8000,
    reason: `vùng 4–8kHz còn rõ, ${ratioDb.toFixed(1)}dB`,
  };
}

function sliceAudioBuffer(buffer, seconds) {
  const length = Math.max(1, Math.min(buffer.length, Math.floor(seconds * buffer.sampleRate)));
  const sliced = new AudioBuffer({
    length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    sliced.copyToChannel(buffer.getChannelData(channel).subarray(0, length), channel);
  }
  return sliced;
}

function mixToMono(buffer) {
  const mono = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: 1,
    sampleRate: buffer.sampleRate,
  });
  const out = mono.getChannelData(0);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      out[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}

async function filterBuffer(buffer, type, frequency) {
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = offline.createBufferSource();
  const filter = offline.createBiquadFilter();
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.707;
  source.connect(filter);
  filter.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

function rms(buffer) {
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let index = 0; index < data.length; index += 1) {
    sum += data[index] * data[index];
  }
  return Math.sqrt(sum / Math.max(1, data.length));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = String(totalSeconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

function formatSampleRate(sampleRate) {
  return `${(sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0)}kHz`;
}

function formatElapsed(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "không rõ";
  if (value < 60) return `${value.toFixed(1)} giây`;
  const mins = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  return `${mins} phút ${secs} giây`;
}

function formatMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "--";
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function buildOutputName(inputName) {
  const base = inputName.replace(/\.[^.]+$/, "");
  return `${base}-restored-fullband-44100.wav`;
}

function buildBenchmarkOutputName(inputName, cutoffHz) {
  const base = inputName.replace(/\.[^.]+$/, "");
  return `${base}-benchmark-${cutoffHz / 1000}khz-restored.wav`;
}

function getErrorMessage(error) {
  if (error.name === "AbortError") return "Đã hủy xử lý";
  if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) {
    return "Không kết nối được máy chủ phục hồi. Hãy kiểm tra backend và Cloudflare Tunnel.";
  }
  return error.message || "Không xử lý được audio";
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
