# FileDrop - Transfer File P2P Berkinerja Tinggi

Aplikasi web yang sederhana, cepat, dan aman untuk mentransfer file secara langsung antar perangkat di jaringan lokal yang sama. Dioptimalkan untuk file berukuran sangat besar (multi-gigabyte) menggunakan teknologi web modern.

Aplikasi ini menggunakan WebRTC untuk komunikasi peer-to-peer, menghilangkan kebutuhan untuk mengunggah file ke server pusat.

## Fitur Unggulan

- **Dukungan File Sangat Besar**: Mentransfer file berukuran multi-gigabyte dengan mudah berkat streaming langsung ke disk menggunakan File System Access API, mencegah crash pada browser.
- **Transfer Multi-Channel Paralel**: Memanfaatkan hingga 4 "pipa" data secara bersamaan untuk meningkatkan throughput dan memaksimalkan kecepatan transfer.
- **Kontrol Aliran Dinamis**: Kecepatan transfer dioptimalkan secara real-time dengan mekanisme *backpressure* cerdas untuk mencegah kemacetan jaringan.
- **Statistik Real-time**: Pantau kemajuan transfer dengan progress bar dan estimasi waktu selesai (ETA) yang akurat.
- **Transfer Tanpa Server**: File dikirim langsung antar pengguna (P2P) untuk kecepatan dan privasi maksimal.
- **Penemuan Perangkat**: Secara otomatis menemukan perangkat lain di jaringan yang sama.
- **Aman**: Komunikasi dienkripsi menggunakan keamanan bawaan WebRTC (DTLS-SRTP).
- **UI Modern**: Antarmuka yang bersih dan responsif dengan tema gelap/terang.
- **Tanpa Instalasi**: Berjalan langsung di peramban web modern mana pun.

## Arsitektur

FileDrop menggunakan arsitektur hibrida:

1.  **Server Sinyal (Node.js/Express/WebSocket)**: Server ringan digunakan untuk "jabat tangan" awal. Tugas satu-satunya adalah mengumumkan ketika pengguna bergabung atau meninggalkan jaringan dan untuk meneruskan pesan sinyal (*offers*, *answers*, *ICE candidates*) antar peer sehingga mereka dapat membuat koneksi langsung.

2.  **Klien (HTML/CSS/JS)**: Frontend menangani semua pekerjaan berat.
    -   **WebRTC**: Membuat beberapa `RTCDataChannel` secara paralel untuk transfer data file berkecepatan tinggi.
    -   **Vite**: Digunakan sebagai alat build modern untuk pengalaman pengembangan yang cepat dan build produksi yang dioptimalkan.
    -   **Manajemen State Terpusat**: Model pub/sub sederhana di `state.js` memastikan aliran data yang dapat diprediksi dan dapat dipelihara.

## Memulai

### Prasyarat

- [Node.js](https://nodejs.org/) (v18.x atau yang lebih baru direkomendasikan)
- [npm](https://www.npmjs.com/)

### Instalasi & Menjalankan

1.  **Clone repositori:**
    ```bash
    git clone <url-repositori>
    cd webapp
    ```

2.  **Instal dependensi:**
    ```bash
    npm install
    ```

3.  **Jalankan server pengembangan:**
    ```bash
    npm run dev
    ```
    Ini akan memulai server pengembangan Vite untuk frontend dan server sinyal Node.js. Buka URL yang disediakan di browser Anda. Untuk menguji fungsionalitas P2P, buka URL yang sama di perangkat lain di jaringan yang sama.

## Skrip yang Tersedia

- `npm run dev`: Memulai server pengembangan Vite dan server Node.js.
- `npm run build`: Mem-build frontend untuk produksi (output ke folder `dist`).
- `npm start`: Memulai server Node.js (ditujukan untuk produksi setelah menjalankan `build`).
- `npm test`: Menjalankan tes backend menggunakan Jest.
- `npm run lint`: Memeriksa semua file JavaScript menggunakan ESLint.
- `npm run format`: Memformat semua file menggunakan Prettier.