// Application Logic for BAKTI NUSA Awardee Data Visualization Dashboard
import Papa from 'papaparse';
import { reconstructSurveyData } from './dataLoader.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Lucide Icons
    lucide.createIcons();

    // 2. Fetch and Reconstruct the data from Google Sheets CSV
    let data;
    try {
        const urls = {
            assessment: import.meta.env.VITE_CSV_ASSESSMENT,
            instrumenAssessment: import.meta.env.VITE_CSV_INSTRUMEN_ASSESSMENT,
            leadpro: import.meta.env.VITE_CSV_LEADPRO,
            instrumenLeadpro: import.meta.env.VITE_CSV_INSTRUMEN_LEADPRO
        };

        if (!urls.assessment) {
            // Fallback for development without env vars (e.g. if loaded statics)
            if (window.SURVEY_DATA) {
                data = window.SURVEY_DATA;
                const loader = document.getElementById('app-loader');
                if (loader) loader.remove();
            } else {
                throw new Error("Spreadsheet URLs not configured and fallback data not found.");
            }
        } else {
            const fetchCSV = async (url) => {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                const text = await res.text();
                return new Promise((resolve, reject) => {
                    Papa.parse(text, {
                        header: true,
                        dynamicTyping: true,
                        skipEmptyLines: true,
                        complete: (results) => resolve(results.data),
                        error: (err) => reject(err)
                    });
                });
            };

            const [rawAssessment, rawInstrumenAssessment, rawLeadpro, rawInstrumenLeadpro] = await Promise.all([
                fetchCSV(urls.assessment),
                fetchCSV(urls.instrumenAssessment),
                fetchCSV(urls.leadpro),
                fetchCSV(urls.instrumenLeadpro)
            ]);

            data = reconstructSurveyData(rawAssessment, rawInstrumenAssessment, rawLeadpro, rawInstrumenLeadpro);

            // Hide the loading overlay
            const loader = document.getElementById('app-loader');
            if (loader) {
                loader.style.transition = 'opacity 0.4s ease';
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 400); // smooth fade out
            }
        }
    } catch (error) {
        console.error("Gagal memuat data dari Google Sheets:", error);
        const loaderText = document.querySelector('#app-loader p');
        if (loaderText) {
            loaderText.innerHTML = `<span style="color: var(--danger); text-align: center; display: block;">Gagal memuat data beasiswa!<br><small style="font-weight: 500;">${error.message}</small></span>`;
        }
        return;
    }

    // 3. State Management
    let state = {
        activeTab: 'overview',
        selectedRegion: 'all',
        selectedAwardee: '',
        selectedLeadproRelation: 'overall',
        matriksSearchQuery: '',
        matriksSortColumn: 0, // Index: 0=Name, 1=Region, 2=Campus, 3=Awal, 4=Tengah, 5=Peer, 6=Manager, 7=External, 8=Leadpro
        matriksSortAscending: true,
        matriksCurrentPage: 1,
        matriksRowsPerPage: 15,
        isExporting: false
    };

    // Store active charts to destroy before re-rendering
    window.charts = {};

    // 4. Populate Filter Dropdowns
    const filterWilayah = document.getElementById('filter-wilayah');
    const filterAwardee = document.getElementById('filter-awardee');
    const filterLeadproRelation = document.getElementById('filter-leadpro-relation');
    const awardeeFilterContainer = document.getElementById('awardee-filter-container');
    const btnPrint = document.getElementById('btn-print');

    // Extract regions
    const regionsSet = new Set();
    Object.values(data.assessments).forEach(aw => {
        if (aw.region) regionsSet.add(aw.region);
    });
    const sortedRegions = Array.from(regionsSet).sort();
    
    // Add regions to select
    sortedRegions.forEach(reg => {
        const opt = document.createElement('option');
        opt.value = reg;
        opt.textContent = reg;
        filterWilayah.appendChild(opt);
    });

    // Populate awardees dropdown based on region
    function updateAwardeeDropdown() {
        const prevSelected = filterAwardee.value;
        filterAwardee.innerHTML = '';
        
        // Add "Semua Awardee" option
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'Semua Awardee';
        filterAwardee.appendChild(optAll);
        
        const region = filterWilayah.value;
        let filteredAwardees = Object.values(data.assessments);
        
        if (region !== 'all') {
            filteredAwardees = filteredAwardees.filter(aw => aw.region === region);
        }
        
        // Sort awardees alphabetically
        filteredAwardees.sort((a, b) => a.name.localeCompare(b.name));
        
        filteredAwardees.forEach(aw => {
            const opt = document.createElement('option');
            opt.value = aw.name;
            opt.textContent = aw.name;
            filterAwardee.appendChild(opt);
        });

        // Try to restore previous selection if it's still in the list, otherwise pick "all"
        if (prevSelected && (prevSelected === 'all' || filteredAwardees.some(aw => aw.name === prevSelected))) {
            filterAwardee.value = prevSelected;
        } else {
            filterAwardee.value = 'all';
        }
        
        state.selectedAwardee = filterAwardee.value;
    }

    // Initialize dropdowns
    updateAwardeeDropdown();

    // Theme Toggling removed (Always Light Mode)
    const body = document.body;

    // 6. Navigation and Tabs
    const menuItems = document.querySelectorAll('.sidebar-menu .menu-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('page-title');

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');
            
            tabContents.forEach(tc => tc.classList.remove('active'));
            document.getElementById(`tab-${tabId}`).classList.add('active');
            
            state.activeTab = tabId;
            updateHeaderUI();
            renderActiveTab();
        });
    });

    function updateHeaderUI() {
        const wilayahFilterContainer = filterWilayah.parentElement;
        if (state.activeTab === 'overview') {
            pageTitle.textContent = 'Ringkasan Eksekutif';
            wilayahFilterContainer.style.display = 'none';
            awardeeFilterContainer.style.display = 'none';
            btnPrint.style.display = 'none';
        } else if (state.activeTab === 'matriks') {
            pageTitle.textContent = 'Matriks Penilaian';
            wilayahFilterContainer.style.display = 'none';
            awardeeFilterContainer.style.display = 'none';
            btnPrint.style.display = 'none';
        } else if (state.activeTab === 'instrumen') {
            pageTitle.textContent = 'Eksplorasi Instrumen';
            wilayahFilterContainer.style.display = 'none';
            awardeeFilterContainer.style.display = 'none';
            btnPrint.style.display = 'none';
        } else {
            // Individual tabs
            pageTitle.textContent = state.activeTab === 'self-assessment' ? 'Evaluasi Mandiri' : 
                                    state.activeTab === 'eval-publik' ? 'Evaluasi Publik' : 'Leadership Project';
            wilayahFilterContainer.style.display = 'flex';
            awardeeFilterContainer.style.display = 'flex';
            btnPrint.style.display = 'inline-flex';
        }
    }

    // Filter Listeners
    filterWilayah.addEventListener('change', (e) => {
        state.selectedRegion = e.target.value;
        updateAwardeeDropdown();
        renderActiveTab();
    });

    filterAwardee.addEventListener('change', (e) => {
        state.selectedAwardee = e.target.value;
        renderActiveTab();
    });

    filterLeadproRelation.addEventListener('change', (e) => {
        state.selectedLeadproRelation = e.target.value;
        renderLeadproTab();
    });

    btnPrint.addEventListener('click', () => {
        // Change button to loading state
        const originalHtml = btnPrint.innerHTML;
        btnPrint.innerHTML = `<i data-lucide="loader" class="spin"></i> <span>Mengekspor...</span>`;
        lucide.createIcons();
        btnPrint.disabled = true;

        // Set state to isExporting and add class to disable CSS transitions
        state.isExporting = true;
        body.classList.add('no-transitions');
        
        // Re-render active tab so charts redraw without animations
        renderActiveTab();
        
        // Wait 250ms for repaint (no transition delay, so it's super fast!)
        setTimeout(() => {
            const element = document.getElementById(`tab-${state.activeTab}`);
            
            // Clean filename
            const cleanName = state.selectedAwardee ? state.selectedAwardee.replace(/\s+/g, '_') : 'Semua';
            const filename = `Laporan_${state.activeTab}_${cleanName}.pdf`;

            // Call html2canvas directly to capture element
            html2canvas(element, {
                scale: 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#f8fafc',
                scrollY: 0,
                scrollX: 0
            }).then(canvas => {
                const imgData = canvas.toDataURL('image/jpeg', 0.95);
                
                // Calculate size in mm for portrait PDF
                const imgWidth = 210; // mm (A4 width)
                const pageHeight = (canvas.height / canvas.width) * imgWidth;
                
                // Create single-page PDF matching the aspect ratio + 20mm margin buffer
                const jsPDF = window.jspdf.jsPDF;
                const pdf = new jsPDF('p', 'mm', [imgWidth + 20, pageHeight + 20]);
                
                // Add image with 10mm margin
                pdf.addImage(imgData, 'JPEG', 10, 10, imgWidth, pageHeight);
                
                // Save document
                pdf.save(filename);

                // Reset exporting state and transitions
                state.isExporting = false;
                body.classList.remove('no-transitions');

                // Restore button state
                btnPrint.innerHTML = originalHtml;
                btnPrint.disabled = false;
                
                renderActiveTab();
            }).catch(err => {
                console.error("PDF Export error:", err);
                state.isExporting = false;
                body.classList.remove('no-transitions');
                btnPrint.innerHTML = originalHtml;
                btnPrint.disabled = false;
                renderActiveTab();
            });
        }, 250);
    });

    // 7. Render Logic
    function renderActiveTab() {
        if (state.activeTab === 'overview') {
            renderOverviewTab();
        } else if (state.activeTab === 'self-assessment') {
            renderSelfAssessmentTab();
        } else if (state.activeTab === 'eval-publik') {
            renderEvalPublikTab();
        } else if (state.activeTab === 'leadpro') {
            renderLeadproTab();
        } else if (state.activeTab === 'matriks') {
            renderMatriksTab();
        } else if (state.activeTab === 'instrumen') {
            renderInstrumenTab();
        }
    }

    // Helpers
    function getThemeColors() {
        return {
            background: '#ffffff',
            text: '#0f172a',
            gridColor: '#e2e8f0',
            primary: '#dc2626',      // Red 600
            secondary: '#ea580c',    // Orange 600
            accent: '#be123c',       // Rose 700
            success: '#10b981',
            warning: '#f59e0b',
            themeMode: 'light'
        };
    }

    function destroyChart(name) {
        if (window.charts[name]) {
            window.charts[name].destroy();
            delete window.charts[name];
        }
    }

    function getIpkBadge(ipk) {
        if (ipk === null || ipk === undefined || isNaN(ipk)) return '<span class="badge badge-kurang">N/A</span>';
        if (ipk >= 3.51) return '<span class="badge badge-cumlaude">Cumlaude</span>';
        if (ipk >= 2.76) return '<span class="badge badge-sangat-memuaskan">Sangat Memuaskan</span>';
        if (ipk >= 2.00) return '<span class="badge badge-memuaskan">Memuaskan</span>';
        return '<span class="badge badge-kurang">Perlu Peningkatan</span>';
    }

    function getLeadproBadge(pct) {
        if (pct === null || pct === undefined || isNaN(pct)) return '<span class="badge badge-kurang">N/A</span>';
        if (pct >= 87.75) return '<span class="badge badge-cumlaude">Sangat Memuaskan</span>';
        if (pct >= 69.00) return '<span class="badge badge-sangat-memuaskan">Memuaskan</span>';
        if (pct >= 50.00) return '<span class="badge badge-memuaskan">Cukup Memuaskan</span>';
        return '<span class="badge badge-kurang">Perlu Peningkatan</span>';
    }

    function getStrengthsAndWeaknesses(stats) {
        if (!stats) return { strength: '-', weakness: '-' };
        const vars = [
            { name: 'Self Maturity', score: stats.self_maturity },
            { name: 'Competency Enrichment', score: stats.competency_enrichment },
            { name: 'Bringing Inspiration', score: stats.bringing_inspiration }
        ];
        vars.sort((a, b) => b.score - a.score);
        return {
            strength: `${vars[0].name} (${vars[0].score.toFixed(2)})`,
            weakness: `${vars[2].name} (${vars[2].score.toFixed(2)})`
        };
    }

    // Recommendation Engine
    function getRecommendations(selfMaturity, compEnrich, bringInsp) {
        let recs = { selfMaturity: [], compEnrich: [], bringInsp: [] };
        
        // Self Maturity
        if (selfMaturity >= 3.51) {
            recs.selfMaturity = [
                "Pertahankan konsistensi dalam menjaga integritas dan keteladanan nilai moral serta spiritual dalam aktivitas sehari-hari.",
                "Jadilah role model bagi rekan-rekan awardee lainnya untuk menginspirasi kedewasaan sikap, kemandirian, dan kematangan emosi.",
                "Teruskan upaya peningkatan kualitas ibadah ritual dan sosial secara berkelanjutan untuk menjaga kemurnian niat."
            ];
        } else if (selfMaturity >= 2.76) {
            recs.selfMaturity = [
                "Tingkatkan kedisiplinan dan komitmen diri dalam menyelesaikan tugas-tugas serta tanggung jawab yang diamanahkan.",
                "Biasakan untuk senantiasa berefleksi sebelum mengambil keputusan penting agar nilai-nilai ketakwaan tetap melandasi setiap tindakan.",
                "Perbanyak diskusi dan bimbingan dengan mentor atau manajer wilayah guna mengasah ketahanan mental dalam menghadapi tantangan."
            ];
        } else {
            recs.selfMaturity = [
                "Prioritaskan penguatan komitmen terhadap integritas pribadi dan pemenuhan tanggung jawab dasar sebagai awardee.",
                "Fokuslah pada latihan pengelolaan emosi, kesabaran, dan daya tahan dalam menghadapi tekanan tugas akademis maupun organisasi.",
                "Ikuti program mentoring secara lebih disiplin dan carilah dukungan dari pembina rohani untuk memperkuat landasan nilai-nilai spiritual."
            ];
        }

        // Competency Enrichment
        if (compEnrich >= 3.51) {
            recs.compEnrich = [
                "Kembangkan kemampuan berpikir strategis dan konseptual agar dapat memecahkan permasalahan sosial yang lebih kompleks.",
                "Bagikan wawasan keilmuan dan keahlian teknis Anda melalui penulisan artikel ilmiah, opini, atau menjadi narasumber diskusi.",
                "Pertahankan keterbukaan terhadap kritik dan saran konstruktif untuk terus memperluas cakrawala berpikir dan wawasan global."
            ];
        } else if (compEnrich >= 2.76) {
            recs.compEnrich = [
                "Latihlah keterampilan dalam memetakan akar masalah (root cause analysis) secara sistematis sebelum merumuskan solusi aksi.",
                "Perluas referensi dan wawasan dengan membaca buku-buku kepemimpinan, riset terbaru, serta mengikuti seminar kepemimpinan.",
                "Tingkatkan keaktifan Anda dalam ruang-ruang diskusi akademis untuk melatih ketajaman analisis dan argumentasi yang logis."
            ];
        } else {
            recs.compEnrich = [
                "Fokus pada peningkatan pemahaman konsep dasar kepemimpinan dan metodologi pemecahan masalah sederhana.",
                "Biasakan diri untuk lebih terbuka, mau mendengarkan, serta menerima masukan dari anggota tim atau rekan sejawat.",
                "Alokasikan waktu khusus setiap minggunya untuk meningkatkan keterampilan teknis (hard skills) yang menunjang efektivitas kerja Anda."
            ];
        }

        // Bringing Inspiration
        if (bringInsp >= 3.51) {
            recs.bringInsp = [
                "Perluas jejaring kolaborasi dengan para tokoh strategis dan pemangku kepentingan di tingkat regional maupun nasional.",
                "Optimalkan pemanfaatan media digital atau tulisan untuk mengampanyekan gagasan kebermanfaatan secara lebih luas dan inspiratif.",
                "Inisiasi gerakan atau proyek sosial baru yang mampu menggerakkan dan mengorganisasi partisipasi aktif dari masyarakat luas."
            ];
        } else if (bringInsp >= 2.76) {
            recs.bringInsp = [
                "Tingkatkan keberanian diri untuk menyuarakan kebenaran dan solusi inovatif, bahkan dalam forum yang kurang populer sekalipun.",
                "Asah terus keterampilan komunikasi publik (public speaking) agar pesan-pesan inspiratif Anda dapat tersampaikan secara persuasif.",
                "Terlibatlah lebih aktif sebagai inisiator atau motor penggerak dalam berbagai forum kolaborasi di lingkungan kampus maupun luar."
            ];
        } else {
            recs.bringInsp = [
                "Mulailah membangun rasa percaya diri dengan berani berpendapat dalam forum-forum kecil atau kelompok diskusi terbatas.",
                "Latihlah kemampuan interpersonal Anda untuk membangun komunikasi yang ramah, hangat, dan suportif dengan orang-orang baru.",
                "Biasakan diri untuk lebih peka dan peduli terhadap isu-isu sosial di sekitar tempat tinggal dengan berpartisipasi dalam aksi sosial."
            ];
        }

        return recs;
    }

    // Leadpro Suggestion Engine
    function getLeadproSuggestions(dampak, peran, kapasitas, refleksi) {
        let suggestions = { dampak: "", peran: "", kapasitas: "", refleksi: "" };
        
        // Dampak
        if (dampak >= 3.51) {
            suggestions.dampak = "Dampak proyek sangat luar biasa. Disarankan untuk memformulasikan model keberlanjutan mandiri (self-sustaining model) agar program dapat terus berjalan tanpa ketergantungan penuh pada pendiri, serta mendokumentasikan modul proyek agar siap direplikasi oleh komunitas lain.";
        } else if (dampak >= 2.76) {
            suggestions.dampak = "Proyek telah memberikan kontribusi positif yang nyata bagi masyarakat. Untuk mengoptimalkan dampak, pertimbangkan untuk memperluas kemitraan dengan pemerintah daerah atau lembaga donor, serta meningkatkan intensitas pelibatan masyarakat lokal.";
        } else {
            suggestions.dampak = "Evaluasi kembali relevansi program dengan kebutuhan riil masyarakat sasaran. Lakukan survei kebutuhan dasar (need assessment) ulang dan fokuskan kegiatan pada solusi yang paling mendesak dan dapat diselesaikan dengan kapasitas tim saat ini.";
        }
        
        // Peran
        if (peran >= 3.51) {
            suggestions.peran = "Kepemimpinan Anda dalam mengelola proyek ini dinilai sangat efektif dan solid. Pertahankan gaya komunikasi yang inklusif dan tingkatkan kemampuan delegasi strategis untuk mempersiapkan kader penerus kepemimpinan proyek ini.";
        } else if (peran >= 2.76) {
            suggestions.peran = "Peran kepemimpinan Anda sudah berjalan cukup baik. Upayakan untuk meningkatkan keterampilan dalam manajemen konflik dalam tim serta menetapkan pembagian tugas (job description) yang lebih rinci dan transparan.";
        } else {
            suggestions.peran = "Fokus pada penguatan kapasitas kepemimpinan personal. Disarankan untuk mengadakan pertemuan rutin tatap muka guna membangun chemistry tim, mengikuti training kepemimpinan, dan lebih terbuka menerima feedback dari anggota tim.";
        }
        
        // Kapasitas
        if (kapasitas >= 3.51) {
            suggestions.kapasitas = "Proyek ini terbukti berhasil menjadi sarana pengembangan kapasitas diri yang sangat baik bagi Anda. Terus asah kompetensi interpersonal, manajemen waktu, dan problem-solving Anda di level proyek yang lebih menantang.";
        } else if (kapasitas >= 2.76) {
            suggestions.kapasitas = "Peningkatan kapasitas pribadi Anda berada di jalur yang benar. Tingkatkan ketangguhan (resilience) dan fleksibilitas dalam menghadapi kendala lapangan yang dinamis dengan belajar dari kegagalan-kegagalan kecil.";
        } else {
            suggestions.kapasitas = "Manfaatkan proyek ini sebagai laboratorium belajar yang aman. Jangan ragu untuk meminta arahan dari mentor/pembina jika menghadapi jalan buntu, serta pelajari kembali teknik-teknik dasar komunikasi efektif dan negosiasi.";
        }
        
        // Refleksi
        if (refleksi >= 3.51) {
            suggestions.refleksi = "Rencana keberlanjutan dan refleksi pasca-proyek Anda sangat matang. Segera susun laporan akhir komprehensif (white paper) dan bagikan cerita inspiratif ini kepada publik untuk menginspirasi gerakan kepemimpinan lainnya.";
        } else if (refleksi >= 2.76) {
            suggestions.refleksi = "Rencana jangka panjang sudah mulai terbentuk. Perjelas kembali mekanisme suksesi, timeline transisi kepengurusan, serta sumber daya finansial/non-finansial jangka panjang agar proyek tidak vakum setelah program beasiswa selesai.";
        } else {
            suggestions.refleksi = "Segera lakukan rapat evaluasi menyeluruh bersama tim dan mentor untuk membahas kelanjutan proyek. Buatlah rencana tindak lanjut (action plan) jangka pendek yang realistis demi menjaga kepercayaan para penerima manfaat.";
        }
        
        return suggestions;
    }


    // ==========================================
    // TAB 1: OVERVIEW LOGIC
    // ==========================================
    function renderOverviewTab() {
        const colors = getThemeColors();
        const activeRegion = 'all';
        
        // 1. Calculate KPIs
        let awardeesList = Object.values(data.assessments);
        if (activeRegion !== 'all') {
            awardeesList = awardeesList.filter(aw => aw.region === activeRegion);
        }

        const totalAwardees = awardeesList.length;
        document.getElementById('kpi-total-awardees').textContent = totalAwardees;

        // Total regions
        const regionsInFilter = activeRegion === 'all' ? sortedRegions.length : 1;
        document.getElementById('kpi-total-regions').textContent = regionsInFilter;

        // Total public responses
        let totalPublicResponses = 0;
        awardeesList.forEach(aw => {
            const peer = aw.stats['Peer Awardee']?.respondent_count || 0;
            const manager = aw.stats['Manajer Wilayah']?.respondent_count || 0;
            const ext = aw.stats['Jejaring Eksternal']?.respondent_count || 0;
            totalPublicResponses += (peer + manager + ext);
        });
        document.getElementById('kpi-total-public-resp').textContent = totalPublicResponses.toLocaleString('id-ID');

        // Total Leadpro responses
        let totalLeadproResponses = 0;
        let leadproCount = 0;
        awardeesList.forEach(aw => {
            const lp = data.leadpro[aw.name];
            if (lp && lp.overall) {
                totalLeadproResponses += lp.overall.respondent_count;
                leadproCount++;
            }
        });
        document.getElementById('kpi-total-leadpro-resp').textContent = totalLeadproResponses.toLocaleString('id-ID');

        // 2. Draw Chart 1: Awardees per Wilayah (Only relevant if "all" is selected)
        destroyChart('awardeePerRegion');
        if (activeRegion === 'all') {
            const regionCounts = sortedRegions.map(reg => {
                return Object.values(data.assessments).filter(aw => aw.region === reg).length;
            });

            const options = {
                chart: { type: 'bar', height: 350, toolbar: { show: false }, background: 'transparent', animations: { enabled: !state.isExporting } },
                theme: { mode: colors.themeMode },
                colors: [colors.primary],
                plotOptions: { bar: { borderRadius: 6, horizontal: false, columnWidth: '55%' } },
                dataLabels: { enabled: true, style: { colors: [colors.text] } },
                series: [{ name: 'Jumlah Awardee', data: regionCounts }],
                xaxis: { categories: sortedRegions, labels: { style: { colors: colors.text } } },
                yaxis: { title: { text: 'Jumlah Awardee', style: { color: colors.text } }, labels: { style: { colors: colors.text } } },
                grid: { borderColor: colors.gridColor }
            };
            window.charts.awardeePerRegion = new ApexCharts(document.querySelector("#chart-awardee-per-region"), options);
            window.charts.awardeePerRegion.render();
        } else {
            // Show single region details
            document.querySelector("#chart-awardee-per-region").innerHTML = `
                <div class="empty-state">
                    <i data-lucide="map-pin" size="32"></i>
                    <p style="margin-top:10px;">Menampilkan data wilayah <strong>${activeRegion}</strong></p>
                    <p style="font-size:0.85rem; color:var(--text-muted);">Total ${totalAwardees} Awardee aktif di wilayah ini.</p>
                </div>
            `;
            lucide.createIcons();
        }

        // 3. Draw Chart 2: Average IPK per Wilayah
        destroyChart('ipkPerRegion');
        let chartRegions = activeRegion === 'all' ? sortedRegions : [activeRegion];
        
        let avgAwal = [];
        let avgTengah = [];
        let avgPublik = [];

        chartRegions.forEach(reg => {
            const regionAwardees = Object.values(data.assessments).filter(aw => aw.region === reg);
            let sumAwal = 0, countAwal = 0;
            let sumTengah = 0, countTengah = 0;
            let sumPub = 0, countPub = 0;

            regionAwardees.forEach(aw => {
                if (aw.stats['Asesmen Awal']?.ipk) {
                    sumAwal += aw.stats['Asesmen Awal'].ipk;
                    countAwal++;
                }
                if (aw.stats['Asesmen Tengah']?.ipk) {
                    sumTengah += aw.stats['Asesmen Tengah'].ipk;
                    countTengah++;
                }
                
                // Average of available public evaluations
                let pubIPKs = [];
                if (aw.stats['Peer Awardee']?.ipk) pubIPKs.push(aw.stats['Peer Awardee'].ipk);
                if (aw.stats['Manajer Wilayah']?.ipk) pubIPKs.push(aw.stats['Manajer Wilayah'].ipk);
                if (aw.stats['Jejaring Eksternal']?.ipk) pubIPKs.push(aw.stats['Jejaring Eksternal'].ipk);
                if (pubIPKs.length > 0) {
                    const avgPub = pubIPKs.reduce((a, b) => a + b, 0) / pubIPKs.length;
                    sumPub += avgPub;
                    countPub++;
                }
            });

            avgAwal.push(countAwal > 0 ? parseFloat((sumAwal / countAwal).toFixed(2)) : 0);
            avgTengah.push(countTengah > 0 ? parseFloat((sumTengah / countTengah).toFixed(2)) : 0);
            avgPublik.push(countPub > 0 ? parseFloat((sumPub / countPub).toFixed(2)) : 0);
        });

        const optionsIpk = {
            chart: { type: 'bar', height: 350, toolbar: { show: false }, background: 'transparent', animations: { enabled: !state.isExporting } },
            theme: { mode: colors.themeMode },
            colors: [colors.primary, colors.success, colors.accent],
            plotOptions: { bar: { borderRadius: 4, columnWidth: '65%' } },
            dataLabels: { enabled: false },
            stroke: { show: true, width: 2, colors: ['transparent'] },
            series: [
                { name: 'Asesmen Awal', data: avgAwal },
                { name: 'Asesmen Tengah', data: avgTengah },
                { name: 'Evaluasi Publik', data: avgPublik }
            ],
            xaxis: { categories: chartRegions, labels: { style: { colors: colors.text } } },
            yaxis: { min: 2.0, max: 4.0, title: { text: 'Skor Rata-rata IPK', style: { color: colors.text } }, labels: { style: { colors: colors.text } } },
            grid: { borderColor: colors.gridColor },
            tooltip: { y: { formatter: val => val.toFixed(2) } }
        };
        window.charts.ipkPerRegion = new ApexCharts(document.querySelector("#chart-ipk-per-region"), optionsIpk);
        window.charts.ipkPerRegion.render();

        // 4. Draw Distribution Charts
        destroyChart('distAwal');
        destroyChart('distTengah');
        destroyChart('distPublik');
        destroyChart('distLeadpro');

        function getCategoryDistribution(type) {
            let counts = { cumlaude: 0, sangat_memuaskan: 0, memuaskan: 0, kurang: 0 };
            awardeesList.forEach(aw => {
                let ipk = null;
                if (type === 'Asesmen Awal' || type === 'Asesmen Tengah') {
                    ipk = aw.stats[type]?.ipk;
                } else if (type === 'public') {
                    let pubIPKs = [];
                    if (aw.stats['Peer Awardee']?.ipk) pubIPKs.push(aw.stats['Peer Awardee'].ipk);
                    if (aw.stats['Manajer Wilayah']?.ipk) pubIPKs.push(aw.stats['Manajer Wilayah'].ipk);
                    if (aw.stats['Jejaring Eksternal']?.ipk) pubIPKs.push(aw.stats['Jejaring Eksternal'].ipk);
                    if (pubIPKs.length > 0) {
                        ipk = pubIPKs.reduce((a, b) => a + b, 0) / pubIPKs.length;
                    }
                } else if (type === 'leadpro') {
                    const lp = data.leadpro[aw.name];
                    if (lp && lp.overall) {
                        ipk = lp.overall.ipk;
                    }
                }
                
                if (ipk !== null && ipk !== undefined && !isNaN(ipk)) {
                    if (ipk >= 3.51) counts.cumlaude++;
                    else if (ipk >= 2.76) counts.sangat_memuaskan++;
                    else if (ipk >= 2.00) counts.memuaskan++;
                    else counts.kurang++;
                }
            });
            return [counts.cumlaude, counts.sangat_memuaskan, counts.memuaskan, counts.kurang];
        }

        const labels = ['Cumlaude', 'Sangat Memuaskan', 'Memuaskan', 'Perlu Peningkatan'];
        const chartColors = [colors.warning, colors.primary, colors.secondary, colors.accent];

        // Awal
        const distAwalData = getCategoryDistribution('Asesmen Awal');
        const optionsAwal = {
            chart: { type: 'donut', height: 250, background: 'transparent', animations: { enabled: !state.isExporting } },
            theme: { mode: colors.themeMode },
            colors: chartColors,
            labels: labels,
            series: distAwalData,
            legend: { show: false },
            dataLabels: { enabled: true }
        };
        window.charts.distAwal = new ApexCharts(document.querySelector("#chart-dist-awal"), optionsAwal);
        window.charts.distAwal.render();

        // Tengah
        const distTengahData = getCategoryDistribution('Asesmen Tengah');
        const optionsTengah = {
            chart: { type: 'donut', height: 250, background: 'transparent', animations: { enabled: !state.isExporting } },
            theme: { mode: colors.themeMode },
            colors: chartColors,
            labels: labels,
            series: distTengahData,
            legend: { show: false },
            dataLabels: { enabled: true }
        };
        window.charts.distTengah = new ApexCharts(document.querySelector("#chart-dist-tengah"), optionsTengah);
        window.charts.distTengah.render();

        // Public
        const distPubData = getCategoryDistribution('public');
        const optionsPub = {
            chart: { type: 'donut', height: 250, background: 'transparent', animations: { enabled: !state.isExporting } },
            theme: { mode: colors.themeMode },
            colors: chartColors,
            labels: labels,
            series: distPubData,
            legend: { show: false },
            dataLabels: { enabled: true }
        };
        window.charts.distPublik = new ApexCharts(document.querySelector("#chart-dist-publik"), optionsPub);
        window.charts.distPublik.render();

        // Leadpro
        const distLeadproData = getCategoryDistribution('leadpro');
        const optionsLeadpro = {
            chart: { type: 'donut', height: 250, background: 'transparent', animations: { enabled: !state.isExporting } },
            theme: { mode: colors.themeMode },
            colors: chartColors,
            labels: labels,
            series: distLeadproData,
            legend: { show: false },
            dataLabels: { enabled: true }
        };
        window.charts.distLeadpro = new ApexCharts(document.querySelector("#chart-dist-leadpro"), optionsLeadpro);
        window.charts.distLeadpro.render();
    }

    // ==========================================
    // TAB 2: SELF ASSESSMENT LOGIC
    // ==========================================
    function renderSelfAssessmentTab() {
        const name = state.selectedAwardee;
        if (!name) {
            document.getElementById('self-assessment-placeholder').style.display = 'block';
            document.getElementById('self-assessment-data').style.display = 'none';
            return;
        }

        document.getElementById('self-assessment-placeholder').style.display = 'none';
        document.getElementById('self-assessment-data').style.display = 'block';

        let statsAwal = null;
        let statsTengah = null;
        let smAwalVal = 0, smTengahVal = 0;
        let ceAwalVal = 0, ceTengahVal = 0;
        let biAwalVal = 0, biTengahVal = 0;
        let ipkAwal = null, ipkTengah = null;
        let qAveragesAwal = Array(50).fill(0);
        let qAveragesTengah = Array(50).fill(0);

        let activeAwardees = Object.values(data.assessments);
        if (state.selectedRegion !== 'all') {
            activeAwardees = activeAwardees.filter(aw => aw.region === state.selectedRegion);
        }

        if (name === 'all') {
            // Group View
            document.getElementById('self-name').textContent = 'Semua Awardee';
            document.getElementById('self-campus').textContent = `Total: ${activeAwardees.length} Awardee`;
            document.getElementById('self-region').textContent = state.selectedRegion === 'all' ? 'Nasional (Semua Wilayah)' : `Wilayah ${state.selectedRegion}`;
            document.getElementById('self-avatar').textContent = 'ALL';

            let countAwal = 0;
            let countTengah = 0;

            activeAwardees.forEach(aw => {
                const sa = aw.stats['Asesmen Awal'];
                const st = aw.stats['Asesmen Tengah'];
                if (sa) {
                    sa.q_averages.forEach((v, i) => { qAveragesAwal[i] += v; });
                    countAwal++;
                }
                if (st) {
                    st.q_averages.forEach((v, i) => { qAveragesTengah[i] += v; });
                    countTengah++;
                }
            });

            if (countAwal > 0) {
                qAveragesAwal = qAveragesAwal.map(v => v / countAwal);
                smAwalVal = qAveragesAwal.slice(0, 19).reduce((a, b) => a + b, 0) / 19;
                ceAwalVal = qAveragesAwal.slice(19, 39).reduce((a, b) => a + b, 0) / 20;
                biAwalVal = qAveragesAwal.slice(39, 50).reduce((a, b) => a + b, 0) / 11;
                ipkAwal = (smAwalVal + ceAwalVal + biAwalVal) / 3;
                statsAwal = {
                    ipk: ipkAwal,
                    self_maturity: smAwalVal,
                    competency_enrichment: ceAwalVal,
                    bringing_inspiration: biAwalVal,
                    q_averages: qAveragesAwal
                };
            }
            if (countTengah > 0) {
                qAveragesTengah = qAveragesTengah.map(v => v / countTengah);
                smTengahVal = qAveragesTengah.slice(0, 19).reduce((a, b) => a + b, 0) / 19;
                ceTengahVal = qAveragesTengah.slice(19, 39).reduce((a, b) => a + b, 0) / 20;
                biTengahVal = qAveragesTengah.slice(39, 50).reduce((a, b) => a + b, 0) / 11;
                ipkTengah = (smTengahVal + ceTengahVal + biTengahVal) / 3;
                statsTengah = {
                    ipk: ipkTengah,
                    self_maturity: smTengahVal,
                    competency_enrichment: ceTengahVal,
                    bringing_inspiration: biTengahVal,
                    q_averages: qAveragesTengah
                };
            }
        } else {
            // Individual View
            const awardee = data.assessments[name];
            statsAwal = awardee.stats['Asesmen Awal'];
            statsTengah = awardee.stats['Asesmen Tengah'];

            document.getElementById('self-name').textContent = awardee.name;
            document.getElementById('self-campus').textContent = awardee.campus;
            document.getElementById('self-region').textContent = awardee.region;
            document.getElementById('self-avatar').textContent = awardee.name.charAt(0);

            ipkAwal = statsAwal ? statsAwal.ipk : null;
            ipkTengah = statsTengah ? statsTengah.ipk : null;

            smAwalVal = statsAwal ? statsAwal.self_maturity : 0;
            smTengahVal = statsTengah ? statsTengah.self_maturity : 0;
            ceAwalVal = statsAwal ? statsAwal.competency_enrichment : 0;
            ceTengahVal = statsTengah ? statsTengah.competency_enrichment : 0;
            biAwalVal = statsAwal ? statsAwal.bringing_inspiration : 0;
            biTengahVal = statsTengah ? statsTengah.bringing_inspiration : 0;

            if (statsAwal) qAveragesAwal = statsAwal.q_averages;
            if (statsTengah) qAveragesTengah = statsTengah.q_averages;
        }

        // IPK Scores
        document.getElementById('self-ipk-awal').textContent = ipkAwal ? ipkAwal.toFixed(2) : 'N/A';
        document.getElementById('self-badge-awal').innerHTML = getIpkBadge(ipkAwal);

        document.getElementById('self-ipk-tengah').textContent = ipkTengah ? ipkTengah.toFixed(2) : 'N/A';
        document.getElementById('self-badge-tengah').innerHTML = getIpkBadge(ipkTengah);

        // Progress Delta
        if (ipkAwal && ipkTengah) {
            const delta = ipkTengah - ipkAwal;
            const sign = delta >= 0 ? '+' : '';
            const statusClass = delta >= 0 ? 'badge-success' : 'badge-danger';
            const icon = delta >= 0 ? 'trending-up' : 'trending-down';
            document.getElementById('self-ipk-delta').textContent = sign + delta.toFixed(2);
            document.getElementById('self-progress-direction').innerHTML = `<span class="badge ${statusClass}"><i data-lucide="${icon}" size="12"></i> ${delta >= 0 ? 'Naik' : 'Turun'}</span>`;
        } else {
            document.getElementById('self-ipk-delta').textContent = 'N/A';
            document.getElementById('self-progress-direction').innerHTML = '';
        }

        // Render Variable Scorecards
        const scorecardsContainer = document.getElementById('self-scorecards-container');
        scorecardsContainer.innerHTML = '';

        const selfVars = [
            {
                name: 'Self Maturity (Q1 - Q19)',
                icon: 'user',
                awal: smAwalVal,
                tengah: smTengahVal,
                color: 'var(--primary)',
                desc: 'Kematangan diri, ketakwaan, kepedulian & keteladanan'
            },
            {
                name: 'Competency Enrichment (Q20 - Q39)',
                icon: 'book-open',
                awal: ceAwalVal,
                tengah: ceTengahVal,
                color: 'var(--success)',
                desc: 'Ketajaman analisis, berpikir solusi & wawasan'
            },
            {
                name: 'Bringing Inspiration (Q40 - Q50)',
                icon: 'send',
                awal: biAwalVal,
                tengah: biTengahVal,
                color: 'var(--accent)',
                desc: 'Inisiatif, kolaborasi & dampak sosial bagi publik'
            }
        ];

        selfVars.forEach(v => {
            let avgVal = 0;
            if (v.awal > 0 && v.tengah > 0) {
                avgVal = (v.awal + v.tengah) / 2;
            } else if (v.awal > 0) {
                avgVal = v.awal;
            } else if (v.tengah > 0) {
                avgVal = v.tengah;
            }
            
            const categoryBadge = getIpkBadge(avgVal);

            scorecardsContainer.innerHTML += `
                <div class="card text-center" style="display: flex; flex-direction: column; justify-content: space-between; padding: 20px; margin-bottom: 0;">
                    <div>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; font-size: 0.95rem;">
                            <i data-lucide="${v.icon}" size="16" style="color: ${v.color};"></i>
                            <span>${v.name}</span>
                        </div>
                        <div class="score-box" style="margin-bottom: 16px;">
                            <div class="score-num" style="font-size: 2.2rem; font-weight: 800; color: var(--text-primary);">${avgVal.toFixed(2)}</div>
                            <div class="score-lbl">Skor Rata-rata</div>
                            <div style="margin-top: 8px;">${categoryBadge}</div>
                        </div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-color); padding-top: 12px; text-align: left;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                            <span style="color: var(--text-secondary);">Skor Awal</span>
                            <strong style="color: var(--text-primary);">${v.awal.toFixed(2)}</strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                            <span style="color: var(--text-secondary);">Skor Tengah</span>
                            <strong style="color: var(--text-primary);">${v.tengah.toFixed(2)}</strong>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; margin-top: 4px; line-height: 1.3;">
                            ${v.desc}
                        </div>
                    </div>
                </div>
            `;
        });

        // Strength and Weakness
        const sawAwal = getStrengthsAndWeaknesses(statsAwal);
        const sawTengah = getStrengthsAndWeaknesses(statsTengah);

        document.getElementById('self-strength-awal').textContent = sawAwal.strength;
        document.getElementById('self-strength-tengah').textContent = sawTengah.strength;
        document.getElementById('self-weakness-awal').textContent = sawAwal.weakness;
        document.getElementById('self-weakness-tengah').textContent = sawTengah.weakness;

        // Recommendations (Based on Asesmen Tengah)
        const refMaturity = statsTengah ? statsTengah.self_maturity : (statsAwal ? statsAwal.self_maturity : 0);
        const refComp = statsTengah ? statsTengah.competency_enrichment : (statsAwal ? statsAwal.competency_enrichment : 0);
        const refInsp = statsTengah ? statsTengah.bringing_inspiration : (statsAwal ? statsAwal.bringing_inspiration : 0);
        
        const recs = getRecommendations(refMaturity, refComp, refInsp);
        
        document.getElementById('rec-self-maturity').innerHTML = recs.selfMaturity.map(r => `<li>${r}</li>`).join('');
        document.getElementById('rec-competency-enrichment').innerHTML = recs.compEnrich.map(r => `<li>${r}</li>`).join('');
        document.getElementById('rec-bringing-inspiration').innerHTML = recs.bringInsp.map(r => `<li>${r}</li>`).join('');

        const topBottomData = statsTengah ? qAveragesTengah : (statsAwal ? qAveragesAwal : null);
        renderTopBottomQuestions(topBottomData);

        // Radar Chart is removed, destroy instance if exists
        destroyChart('selfRadar');

        lucide.createIcons();
    }

    function renderTopBottomQuestions(qAverages) {
        if (!qAverages || qAverages.length === 0) {
            document.getElementById('self-top-questions').innerHTML = '<div class="empty-state">Data tidak tersedia</div>';
            document.getElementById('self-bottom-questions').innerHTML = '<div class="empty-state">Data tidak tersedia</div>';
            return;
        }

        const qList = data.questions.assessment;
        
        // Map questions to average scores
        const qScores = qList.map((q, idx) => {
            return {
                code: q.code,
                text: q.self_text || q.public_text,
                score: qAverages[idx]
            };
        });

        // Sort for Top (descending > 3.50) and Bottom (ascending < 3.00)
        const top5 = [...qScores]
            .filter(q => q.score > 3.50)
            .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, undefined, {numeric: true}))
            .slice(0, 5);

        const bottom5 = [...qScores]
            .filter(q => q.score < 3.00)
            .sort((a, b) => a.score - b.score || a.code.localeCompare(b.code, undefined, {numeric: true}))
            .slice(0, 5);

        const topContainer = document.getElementById('self-top-questions');
        const bottomContainer = document.getElementById('self-bottom-questions');

        if (top5.length === 0) {
            topContainer.innerHTML = `
                <div class="empty-state" style="padding: 24px 0; text-align: center; width: 100%;">
                    <i data-lucide="info" size="24" style="color: var(--text-muted); margin-bottom: 8px;"></i>
                    <p style="font-size: 0.8rem; color: var(--text-muted);">Tidak ada pertanyaan dengan skor &gt; 3.50</p>
                </div>
            `;
        } else {
            topContainer.innerHTML = top5.map(q => `
                <div class="instrument-item">
                    <span class="instrument-code">${q.code}</span>
                    <div style="flex:1;">
                        <div class="q-detail-header" style="margin-bottom:2px;">
                            <span style="font-size:0.8rem; font-weight:600; color:var(--text-primary);">${q.code}</span>
                            <strong style="color:var(--success); font-size:0.9rem;">${q.score.toFixed(2)}</strong>
                        </div>
                        <p style="font-size:0.8rem; color:var(--text-secondary); line-height:1.3;">${q.text}</p>
                    </div>
                </div>
            `).join('');
        }

        if (bottom5.length === 0) {
            bottomContainer.innerHTML = `
                <div class="empty-state" style="padding: 24px 0; text-align: center; width: 100%;">
                    <i data-lucide="check-circle" size="24" style="color: var(--success); margin-bottom: 8px;"></i>
                    <p style="font-size: 0.8rem; color: var(--text-muted);">Semua pertanyaan bernilai &ge; 3.00</p>
                </div>
            `;
        } else {
            bottomContainer.innerHTML = bottom5.map(q => `
                <div class="instrument-item">
                    <span class="instrument-code" style="background-color:var(--danger);">${q.code}</span>
                    <div style="flex:1;">
                        <div class="q-detail-header" style="margin-bottom:2px;">
                            <span style="font-size:0.8rem; font-weight:600; color:var(--text-primary);">${q.code}</span>
                            <strong style="color:var(--danger); font-size:0.9rem;">${q.score.toFixed(2)}</strong>
                        </div>
                        <p style="font-size:0.8rem; color:var(--text-secondary); line-height:1.3;">${q.text}</p>
                    </div>
                </div>
            `).join('');
        }
    }


    // ==========================================
    // TAB 3: EVALUASI PUBLIK (360) LOGIC
    // ==========================================
    function renderEvalPublikTab() {
        const name = state.selectedAwardee;
        if (!name) {
            document.getElementById('eval-publik-placeholder').style.display = 'block';
            document.getElementById('eval-publik-data').style.display = 'none';
            return;
        }

        document.getElementById('eval-publik-placeholder').style.display = 'none';
        document.getElementById('eval-publik-data').style.display = 'block';

        let countManager = 0;
        let countPeer = 0;
        let countExternal = 0;

        let selfMaturity = 0, selfComp = 0, selfInsp = 0, selfIpk = 0;
        let peerMaturity = 0, peerComp = 0, peerInsp = 0, peerIpk = 0;
        let managerMaturity = 0, managerComp = 0, managerInsp = 0, managerIpk = 0;
        let externalMaturity = 0, externalComp = 0, externalInsp = 0, externalIpk = 0;

        let hasSelf = false, hasPeer = false, hasManager = false, hasExternal = false;

        let activeAwardees = Object.values(data.assessments);
        if (state.selectedRegion !== 'all') {
            activeAwardees = activeAwardees.filter(aw => aw.region === state.selectedRegion);
        }

        if (name === 'all') {
            // Group View
            let totalAwardees = activeAwardees.length;
            let metManager = 0, metPeer = 0, metExternal = 0;
            let sumManagerResp = 0, sumPeerResp = 0, sumExternalResp = 0;
            let sumPeerTarget = 0;
            
            let countSelf = 0, countP = 0, countM = 0, countE = 0;

            activeAwardees.forEach(aw => {
                // Peer target for this awardee's region is N - 1
                const targetPeer = Math.max(0, Object.values(data.assessments).filter(x => x.region === aw.region).length - 1);
                sumPeerTarget += targetPeer;

                // Self avg
                let sm = 0, ce = 0, bi = 0, ipk = 0, c = 0;
                if (aw.stats['Asesmen Awal']) {
                    sm += aw.stats['Asesmen Awal'].self_maturity;
                    ce += aw.stats['Asesmen Awal'].competency_enrichment;
                    bi += aw.stats['Asesmen Awal'].bringing_inspiration;
                    ipk += aw.stats['Asesmen Awal'].ipk;
                    c++;
                }
                if (aw.stats['Asesmen Tengah']) {
                    sm += aw.stats['Asesmen Tengah'].self_maturity;
                    ce += aw.stats['Asesmen Tengah'].competency_enrichment;
                    bi += aw.stats['Asesmen Tengah'].bringing_inspiration;
                    ipk += aw.stats['Asesmen Tengah'].ipk;
                    c++;
                }
                if (c > 0) {
                    selfMaturity += (sm / c);
                    selfComp += (ce / c);
                    selfInsp += (bi / c);
                    selfIpk += (ipk / c);
                    countSelf++;
                }

                // Peer
                const pStats = aw.stats['Peer Awardee'];
                if (pStats) {
                    peerMaturity += pStats.self_maturity;
                    peerComp += pStats.competency_enrichment;
                    peerInsp += pStats.bringing_inspiration;
                    peerIpk += pStats.ipk;
                    sumPeerResp += pStats.respondent_count;
                    countP++;
                    if (pStats.respondent_count >= targetPeer) metPeer++;
                } else {
                    if (targetPeer === 0) metPeer++;
                }

                // Manager
                const mStats = aw.stats['Manajer Wilayah'];
                if (mStats) {
                    managerMaturity += mStats.self_maturity;
                    managerComp += mStats.competency_enrichment;
                    managerInsp += mStats.bringing_inspiration;
                    managerIpk += mStats.ipk;
                    sumManagerResp += mStats.respondent_count;
                    countM++;
                    if (mStats.respondent_count >= 1) metManager++;
                }

                // External
                const eStats = aw.stats['Jejaring Eksternal'];
                if (eStats) {
                    externalMaturity += eStats.self_maturity;
                    externalComp += eStats.competency_enrichment;
                    externalInsp += eStats.bringing_inspiration;
                    externalIpk += eStats.ipk;
                    sumExternalResp += eStats.respondent_count;
                    countE++;
                    if (eStats.respondent_count >= 30) metExternal++;
                }
            });

            if (countSelf > 0) {
                selfMaturity /= countSelf; selfComp /= countSelf; selfInsp /= countSelf; selfIpk /= countSelf;
                hasSelf = true;
            }
            if (countP > 0) {
                peerMaturity /= countP; peerComp /= countP; peerInsp /= countP; peerIpk /= countP;
                hasPeer = true;
                countPeer = sumPeerResp / countP; // average
            }
            if (countM > 0) {
                managerMaturity /= countM; managerComp /= countM; managerInsp /= countM; managerIpk /= countM;
                hasManager = true;
                countManager = sumManagerResp / countM; // average
            }
            if (countE > 0) {
                externalMaturity /= countE; externalComp /= countE; externalInsp /= countE; externalIpk /= countE;
                hasExternal = true;
                countExternal = sumExternalResp / countE; // average
            }

            // Set compliance values and labels
            document.getElementById('comp-manager-val').textContent = `${countM} / ${totalAwardees}`;
            document.getElementById('comp-peer-val').textContent = `${countP} / ${totalAwardees}`;
            document.getElementById('comp-external-val').textContent = `${sumExternalResp} / ${30 * totalAwardees}`;
            
            document.querySelector('#comp-manager > span').textContent = 'Manajer Wilayah (Min. 1 per Awardee)';
            document.querySelector('#comp-peer > span').textContent = 'Peer Awardee (Rekan Wilayah)';
            document.querySelector('#comp-external > span').textContent = 'Jejaring Eksternal (Min. 30 per Awardee)';

            updateComplianceUI('comp-manager', countM, totalAwardees, 'comp-manager-badge');
            updateComplianceUI('comp-peer', countP, totalAwardees, 'comp-peer-badge');
            updateExternalComplianceUI('comp-external', countExternal, 'comp-external-badge');

        } else {
            // Individual View
            const awardee = data.assessments[name];
            countManager = awardee.stats['Manajer Wilayah']?.respondent_count || 0;
            countPeer = awardee.stats['Peer Awardee']?.respondent_count || 0;
            countExternal = awardee.stats['Jejaring Eksternal']?.respondent_count || 0;

            const targetPeer = Math.max(0, Object.values(data.assessments).filter(x => x.region === awardee.region).length - 1);

            document.getElementById('comp-manager-val').textContent = `${countManager} / 1`;
            document.getElementById('comp-peer-val').textContent = `${countPeer} / ${targetPeer}`;
            document.getElementById('comp-external-val').textContent = `${countExternal} / 30`;

            document.querySelector('#comp-manager > span').textContent = 'Manajer Wilayah (Min. 1)';
            document.querySelector('#comp-peer > span').textContent = `Peer Awardee (Min. ${targetPeer})`;
            document.querySelector('#comp-external > span').textContent = 'Jejaring Eksternal (Min. 30)';

            updateComplianceUI('comp-manager', countManager, 1, 'comp-manager-badge');
            updateComplianceUI('comp-peer', countPeer, targetPeer, 'comp-peer-badge');
            updateExternalComplianceUI('comp-external', countExternal, 'comp-external-badge');

            // Self avg
            let c = 0;
            if (awardee.stats['Asesmen Awal']) {
                selfMaturity += awardee.stats['Asesmen Awal'].self_maturity;
                selfComp += awardee.stats['Asesmen Awal'].competency_enrichment;
                selfInsp += awardee.stats['Asesmen Awal'].bringing_inspiration;
                selfIpk += awardee.stats['Asesmen Awal'].ipk;
                c++;
            }
            if (awardee.stats['Asesmen Tengah']) {
                selfMaturity += awardee.stats['Asesmen Tengah'].self_maturity;
                selfComp += awardee.stats['Asesmen Tengah'].competency_enrichment;
                selfInsp += awardee.stats['Asesmen Tengah'].bringing_inspiration;
                selfIpk += awardee.stats['Asesmen Tengah'].ipk;
                c++;
            }
            if (c > 0) {
                selfMaturity /= c; selfComp /= c; selfInsp /= c; selfIpk /= c;
                hasSelf = true;
            }

            const pStats = awardee.stats['Peer Awardee'];
            if (pStats) {
                peerMaturity = pStats.self_maturity; peerComp = pStats.competency_enrichment; peerInsp = pStats.bringing_inspiration; peerIpk = pStats.ipk;
                hasPeer = true;
            }
            const mStats = awardee.stats['Manajer Wilayah'];
            if (mStats) {
                managerMaturity = mStats.self_maturity; managerComp = mStats.competency_enrichment; managerInsp = mStats.bringing_inspiration; managerIpk = mStats.ipk;
                hasManager = true;
            }
            const eStats = awardee.stats['Jejaring Eksternal'];
            if (eStats) {
                externalMaturity = eStats.self_maturity; externalComp = eStats.competency_enrichment; externalInsp = eStats.bringing_inspiration; externalIpk = eStats.ipk;
                hasExternal = true;
            }
        }

        function updateComplianceUI(elId, current, target, badgeId) {
            const el = document.getElementById(elId);
            const badge = document.getElementById(badgeId);
            if (current >= target) {
                el.className = 'compliance-card met';
                badge.innerHTML = '<span class="badge badge-success"><i data-lucide="check" size="10"></i> Terpenuhi</span>';
            } else {
                el.className = 'compliance-card unmet';
                badge.innerHTML = '<span class="badge badge-danger"><i data-lucide="alert-triangle" size="10"></i> Belum Terpenuhi</span>';
            }
        }

        function updateExternalComplianceUI(elId, count, badgeId) {
            const el = document.getElementById(elId);
            const badge = document.getElementById(badgeId);
            
            let statusText = '';
            let cardClass = 'compliance-card';
            let badgeClass = 'badge';
            let iconName = 'alert-triangle';
            
            if (count > 30) {
                statusText = 'Sangat Memuaskan';
                cardClass += ' met-excel';
                badgeClass += ' badge-success';
                iconName = 'check-check';
            } else if (count >= 24) {
                statusText = 'Memuaskan';
                cardClass += ' met';
                badgeClass += ' badge-success';
                iconName = 'check';
            } else if (count >= 16) {
                statusText = 'Cukup Memuaskan';
                cardClass += ' warning';
                badgeClass += ' badge-cumlaude';
                iconName = 'info';
            } else if (count >= 8) {
                statusText = 'Kurang Memuaskan';
                cardClass += ' kurang';
                badgeClass += ' badge-kurang';
                iconName = 'alert-circle';
            } else {
                statusText = 'Tidak Memuaskan';
                cardClass += ' unmet';
                badgeClass += ' badge-danger';
                iconName = 'alert-triangle';
            }
            
            el.className = cardClass;
            badge.innerHTML = `<span class="${badgeClass}"><i data-lucide="${iconName}" size="10"></i> ${statusText}</span>`;
        }

        function updateGroupComplianceUI(elId, met, total, badgeId) {
            const el = document.getElementById(elId);
            const badge = document.getElementById(badgeId);
            const pct = total > 0 ? Math.round((met / total) * 100) : 0;
            if (pct >= 80) {
                el.className = 'compliance-card met';
                badge.innerHTML = `<span class="badge badge-success"><i data-lucide="check" size="10"></i> ${pct}% Awardee</span>`;
            } else {
                el.className = 'compliance-card unmet';
                badge.innerHTML = `<span class="badge badge-danger"><i data-lucide="alert-triangle" size="10"></i> ${pct}% Awardee</span>`;
            }
        }

        // Populating 360 Perspective Scorecards
        const scorecardsContainer = document.getElementById('eval-scorecards-container');
        scorecardsContainer.innerHTML = '';

        const ipkSelf = hasSelf ? selfIpk : null;

        const perspectives = [
            { 
                name: 'Mandiri (Self)', 
                icon: 'user', 
                has: hasSelf, 
                m: selfMaturity, 
                c: selfComp, 
                i: selfInsp, 
                ipk: selfIpk, 
                color: 'var(--primary)' 
            },
            { 
                name: 'Rekan (Peer)', 
                icon: 'users', 
                has: hasPeer, 
                m: peerMaturity, 
                c: peerComp, 
                i: peerInsp, 
                ipk: peerIpk, 
                color: 'var(--success)' 
            },
            { 
                name: 'Manajer (Manager)', 
                icon: 'user-check', 
                has: hasManager, 
                m: managerMaturity, 
                c: managerComp, 
                i: managerInsp, 
                ipk: managerIpk,
                color: 'var(--warning)' 
            },
            { 
                name: 'Jejaring (External)', 
                icon: 'globe', 
                has: hasExternal, 
                m: externalMaturity, 
                c: externalComp, 
                i: externalInsp, 
                ipk: externalIpk,
                color: 'var(--accent)' 
            }
        ];

        perspectives.forEach((p, idx) => {
            if (!p.has) {
                // Render N/A Card
                scorecardsContainer.innerHTML += `
                    <div class="eval-stack-card" style="opacity: 0.7;">
                        <div class="eval-stack-col-score">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: var(--text-muted); margin-bottom: 12px; font-size: 0.95rem;">
                                <i data-lucide="${p.icon}" size="16"></i>
                                <span>${p.name}</span>
                            </div>
                            <div class="score-box" style="margin-bottom: 0; background-color: var(--bg-tertiary); width: 100%;">
                                <div class="score-num" style="color: var(--text-muted); font-size: 1.8rem;">N/A</div>
                                <div class="score-lbl">Belum Ada Data</div>
                            </div>
                        </div>
                        <div class="eval-stack-col-details" style="color: var(--text-muted);">
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                                <span>Self Maturity</span>
                                <strong>-</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                                <span>Competency Enrichment</span>
                                <strong>-</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                                <span>Bringing Inspiration</span>
                                <strong>-</strong>
                            </div>
                        </div>
                        <div class="eval-stack-col-interpret" style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">
                            Analisis gap tidak dapat dihitung karena data evaluasi perspektif ini belum tersedia.
                        </div>
                    </div>
                `;
                return;
            }

            // Sub-scores details section
            const detailsHtml = `
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                    <span style="color: var(--text-secondary); font-weight: 500;">Self Maturity</span>
                    <strong style="color: var(--text-primary);">${p.m.toFixed(2)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
                    <span style="color: var(--text-secondary); font-weight: 500;">Competency Enrichment</span>
                    <strong style="color: var(--text-primary);">${p.c.toFixed(2)}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
                    <span style="color: var(--text-secondary); font-weight: 500;">Bringing Inspiration</span>
                    <strong style="color: var(--text-primary);">${p.i.toFixed(2)}</strong>
                </div>
            `;

            // Score column section
            const scoreHtml = `
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; font-size: 0.95rem;">
                    <i data-lucide="${p.icon}" size="16" style="color: ${p.color};"></i>
                    <span>${p.name}</span>
                </div>
                <div class="score-box" style="margin-bottom: 0; width: 100%;">
                    <div class="score-num" style="font-size: 2rem;">${p.ipk.toFixed(2)}</div>
                    <div class="score-lbl">IPK Perspektif</div>
                    <div style="margin-top: 8px;">${getIpkBadge(p.ipk)}</div>
                </div>
            `;

            // Gap & Interpretation section
            let interpretHtml = '';
            const isGroup = name === 'all';
            const subjectLower = isGroup ? 'awardee' : 'kamu';

            if (idx === 0) {
                // Mandiri (Self) - Baseline
                interpretHtml = `
                    <div class="callout info" style="margin: 0; border-left-color: var(--info);">
                        <h4 style="margin-bottom: 6px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;"><i data-lucide="info" size="14"></i> Persepsi Diri (Baseline)</h4>
                        <p style="font-size: 0.75rem; line-height: 1.4; color: var(--text-secondary); margin: 0;">
                            Evaluasi Mandiri mencerminkan tingkat kesadaran diri (self-awareness) dan cara Anda menilai kapasitas pribadi. Gunakan nilai ini sebagai cermin pembanding terhadap umpan balik objektif dari rekan kerja, manajer, dan jejaring eksternal untuk menyelaraskan persepsi diri Anda.
                        </p>
                    </div>
                `;
            } else {
                // Peer, Manager, External Gaps
                if (ipkSelf !== null) {
                    const gap = p.ipk - ipkSelf;
                    const sign = gap >= 0 ? '+' : '';
                    const gapStr = sign + gap.toFixed(2);
                    
                    let gapBgColor = '';
                    let gapTextColor = '';
                    let gapLabel = '';
                    let interpretTitle = '';
                    let interpretText = '';
                    let calloutClass = 'callout';

                    if (gap > 0) {
                        gapBgColor = 'rgba(16, 185, 129, 0.1)';
                        gapTextColor = 'var(--success)';
                        gapLabel = 'Positif (Publik > Mandiri)';
                        
                        if (gap > 0.3) {
                            calloutClass += ' warning';
                            interpretTitle = '<i data-lucide="alert-circle" size="14"></i> Kecenderungan Imposter Syndrome';
                            if (p.name.includes('Peer')) {
                                interpretText = `Rekan sejawat menilai Anda jauh lebih kompeten, kolaboratif, dan solutif dibanding penilaian Anda sendiri. Selisih yang cukup besar (<strong>${gapStr}</strong>) mengindikasikan Anda mungkin merasa canggung atau kurang percaya diri (imposter) dalam tim, padahal rekan sejawat sangat mengapresiasi kontribusi nyata Anda.`;
                            } else if (p.name.includes('Manager')) {
                                interpretText = `Manajer Wilayah mengamati potensi kepemimpinan dan kinerja objektif Anda jauh melebihi yang Anda rasakan. Dengan gap yang signifikan ini (<strong>${gapStr}</strong>), Manajer menilai Anda siap untuk memikul tanggung jawab yang lebih besar, meskipun secara internal Anda masih ragu.`;
                            } else {
                                interpretText = `Masyarakat atau jejaring eksternal merasakan manfaat kehadiran Anda jauh lebih besar dibanding penilaian mandiri Anda. Gap positif yang lebar (<strong>${gapStr}</strong>) mengonfirmasi keberhasilan program atau proyek sosial Anda di lapangan yang dirasakan nyata oleh publik.`;
                            }
                        } else {
                            calloutClass += ' success';
                            interpretTitle = '<i data-lucide="check-circle" size="14"></i> Penilaian Sehat & Rendah Hati';
                            if (p.name.includes('Peer')) {
                                interpretText = `Penilaian Anda dan rekan sejawat sangat selaras dengan sedikit apresiasi positif (<strong>${gapStr}</strong>). Ini menunjukkan hubungan interpersonal yang seimbang, di mana Anda dihargai di lingkungan pertemanan/tim secara objektif.`;
                            } else if (p.name.includes('Manager')) {
                                interpretText = `Sinergi ekspektasi yang sehat dengan Manajer Wilayah (gap: <strong>${gapStr}</strong>). Standar kerja yang Anda terapkan selaras dengan arahan dan penilaian Manajer, menunjukkan komunikasi kerja yang berjalan baik dan produktif.`;
                            } else {
                                interpretText = `Resonansi dampak sosial Anda selaras dengan yang dirasakan oleh jejaring luar (gap: <strong>${gapStr}</strong>). Ini menunjukkan kesesuaian yang sehat antara rencana program pemberdayaan Anda dengan kebutuhan nyata masyarakat sasaran.`;
                            }
                        }
                    } else if (gap < 0) {
                        gapBgColor = 'rgba(239, 68, 68, 0.1)';
                        gapTextColor = 'var(--danger)';
                        gapLabel = 'Negatif (Publik < Mandiri)';

                        if (Math.abs(gap) > 0.3) {
                            calloutClass += ' warning';
                            interpretTitle = '<i data-lucide="alert-triangle" size="14"></i> Risiko Kesenjangan Persepsi (Dunning-Kruger)';
                            if (p.name.includes('Peer')) {
                                interpretText = `Rekan sejawat menilai kinerja atau kerja sama Anda jauh di bawah yang Anda yakini (gap: <strong>${gapStr}</strong>). Ini mengindikasikan adanya blind spot dalam komunikasi, kerja tim, atau perilaku sehari-hari yang perlu diselaraskan agar tidak memicu gesekan kelompok.`;
                            } else if (p.name.includes('Manager')) {
                                interpretText = `Manajer menilai kinerja kepemimpinan atau kepatuhan program Anda di bawah ekspektasi mandiri Anda (gap: <strong>${gapStr}</strong>). Hal ini krusial dan membutuhkan diskusi umpan balik langsung untuk menyamakan visi dan standar kinerja.`;
                            } else {
                                interpretText = `Terdapat jurang pemisah yang lebar di mana Anda merasa sudah berdampak besar, namun masyarakat menilai dampaknya masih minim (gap: <strong>${gapStr}</strong>). Penting mengevaluasi strategi pendekatan sosial dan relevansi proyek Anda.`;
                            }
                        } else {
                            calloutClass += ' info';
                            interpretTitle = '<i data-lucide="info" size="14"></i> Kepercayaan Diri yang Baik';
                            if (p.name.includes('Peer')) {
                                interpretText = `Selisih negatif tipis (<strong>${gapStr}</strong>) merupakan hal yang wajar dalam dinamika tim dan menunjukkan rasa percaya diri yang baik. Sedikit evaluasi pada aspek kolaborasi akan mengoptimalkan hubungan dengan rekan.`;
                            } else if (p.name.includes('Manager')) {
                                interpretText = `Selisih negatif tipis di mata Manajer (<strong>${gapStr}</strong>) adalah hal wajar dalam evaluasi formal. Anda memiliki keyakinan diri yang kuat, dan sedikit penyelarasan target operasional akan menutup celah persepsi ini.`;
                            } else {
                                interpretText = `Selisih negatif tipis (<strong>${gapStr}</strong>) menunjukkan Anda percaya diri menjalankan peran sosial. Masukan kecil dari masyarakat/jejaring luar dapat digunakan untuk memperluas kemitraan proyek Anda.`;
                            }
                        }
                    } else {
                        gapBgColor = 'rgba(59, 130, 246, 0.1)';
                        gapTextColor = 'var(--info)';
                        gapLabel = 'Sempurna (Publik = Mandiri)';
                        calloutClass += ' success';
                        interpretTitle = '<i data-lucide="check-circle-2" size="14"></i> Keseimbangan Sempurna (Self-Awareness Tinggi)';
                        interpretText = `Penilaian Anda sangat ideal dan presisi (gap: <strong>0.00</strong>). Ini menunjukkan Anda memiliki tingkat kesadaran diri (self-awareness) yang sangat tinggi, tahu persis kekuatan dan kelemahan Anda, dan publik sepenuhnya mengonfirmasi hal tersebut.`;
                    }

                    interpretHtml = `
                        <div class="eval-gap-badge-container">
                            <div class="eval-gap-num-box" style="background-color: ${gapBgColor}; color: ${gapTextColor};">
                                Gap: ${gapStr}
                            </div>
                            <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary);">${gapLabel}</span>
                        </div>
                        <div class="${calloutClass}" style="margin: 0; padding: 12px 16px;">
                            <h4 style="margin-bottom: 4px; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">${interpretTitle}</h4>
                            <p style="font-size: 0.75rem; line-height: 1.4; color: var(--text-secondary); margin: 0;">${interpretText}</p>
                        </div>
                    `;
                } else {
                    interpretHtml = `
                        <div class="callout" style="margin: 0; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
                            Hubungkan dengan Evaluasi Mandiri untuk menghitung analisis gap.
                        </div>
                    `;
                }
            }

            scorecardsContainer.innerHTML += `
                <div class="eval-stack-card">
                    <div class="eval-stack-col-score">
                        ${scoreHtml}
                    </div>
                    <div class="eval-stack-col-details">
                        ${detailsHtml}
                    </div>
                    <div class="eval-stack-col-interpret">
                        ${interpretHtml}
                    </div>
                </div>
            `;
        });

        // Radar Chart is removed, dynamically render score cards instead
        destroyChart('evalRadar');

        lucide.createIcons();
    }

    // ==========================================
    // TAB 4: LEADERSHIP PROJECT (LEADPRO) LOGIC
    // ==========================================
    function renderLeadproTab() {
        const name = state.selectedAwardee;
        if (!name) {
            document.getElementById('leadpro-placeholder').style.display = 'block';
            document.getElementById('leadpro-data').style.display = 'none';
            return;
        }

        let lpData = null;
        let activeLps = [];
        let activeAwardees = Object.values(data.assessments);
        if (state.selectedRegion !== 'all') {
            activeAwardees = activeAwardees.filter(aw => aw.region === state.selectedRegion);
        }

        if (name === 'all') {
            activeAwardees.forEach(aw => {
                const lp = data.leadpro[aw.name];
                if (lp) {
                    activeLps.push(lp);
                }
            });

            if (activeLps.length === 0) {
                document.getElementById('leadpro-placeholder').innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="frown" size="48"></i>
                        <p>Data Leadership Project tidak tersedia untuk wilayah ini.</p>
                    </div>
                `;
                document.getElementById('leadpro-placeholder').style.display = 'block';
                document.getElementById('leadpro-data').style.display = 'none';
                lucide.createIcons();
                return;
            }
        } else {
            lpData = data.leadpro[name];
            if (!lpData) {
                // This awardee has no LeadPro project registered!
                document.getElementById('leadpro-placeholder').innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="frown" size="48"></i>
                        <p><strong>${name}</strong> tidak terdaftar dalam survey Leadership Project (Leadpro).</p>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-top: 4px;">Data survey Leadpro hanya tersedia untuk 44 dari 55 Awardee.</p>
                    </div>
                `;
                document.getElementById('leadpro-placeholder').style.display = 'block';
                document.getElementById('leadpro-data').style.display = 'none';
                lucide.createIcons();
                return;
            }
        }

        document.getElementById('leadpro-placeholder').style.display = 'none';
        document.getElementById('leadpro-data').style.display = 'block';

        // Project Info
        if (name === 'all') {
            document.getElementById('leadpro-project-name').textContent = 'Semua Proyek Kepemimpinan';
            document.getElementById('leadpro-awardee-name').textContent = state.selectedRegion === 'all' ? 'Nasional (44 Proyek)' : `Wilayah ${state.selectedRegion} (${activeLps.length} Proyek)`;
            document.getElementById('leadpro-project-avatar').textContent = 'ALL';
        } else {
            document.getElementById('leadpro-project-name').textContent = lpData.project;
            document.getElementById('leadpro-awardee-name').textContent = name;
            document.getElementById('leadpro-project-avatar').textContent = lpData.project.charAt(0);
        }

        // Populate Leadpro Relation Dropdown
        const currentRel = filterLeadproRelation.value || 'overall';
        filterLeadproRelation.innerHTML = '<option value="overall">Semua (Overall)</option>';

        const uniqueRelations = new Set();
        if (name === 'all') {
            activeLps.forEach(lp => {
                Object.keys(lp.by_relation).forEach(rel => {
                    uniqueRelations.add(rel);
                });
            });
            const sortedRelations = Array.from(uniqueRelations).sort();
            sortedRelations.forEach(rel => {
                let relRespCount = 0;
                activeLps.forEach(lp => {
                    if (lp.by_relation[rel]) {
                        relRespCount += lp.by_relation[rel].respondent_count;
                    }
                });
                const opt = document.createElement('option');
                opt.value = rel;
                opt.textContent = `${rel} (${relRespCount} resp)`;
                filterLeadproRelation.appendChild(opt);
            });
        } else {
            Object.keys(lpData.by_relation).forEach(rel => {
                uniqueRelations.add(rel);
                const opt = document.createElement('option');
                opt.value = rel;
                opt.textContent = `${rel} (${lpData.by_relation[rel].respondent_count} resp)`;
                filterLeadproRelation.appendChild(opt);
            });
        }
        
        // Restore selection if valid
        if (currentRel === 'overall' || uniqueRelations.has(currentRel)) {
            filterLeadproRelation.value = currentRel;
            state.selectedLeadproRelation = currentRel;
        } else {
            filterLeadproRelation.value = 'overall';
            state.selectedLeadproRelation = 'overall';
        }

        const activeRel = state.selectedLeadproRelation;
        let activeStats = null;

        if (name === 'all') {
            let sumDampak = 0;
            let sumPeran = 0;
            let sumKapasitas = 0;
            let sumRefleksi = 0;
            let sumIpk = 0;
            let sumRespondentCount = 0;
            let qAverages = Array(22).fill(0);
            let projectCountForRel = 0;

            activeLps.forEach(lp => {
                const stats = activeRel === 'overall' ? lp.overall : lp.by_relation[activeRel];
                if (stats) {
                    sumDampak += stats.dampak;
                    sumPeran += stats.peran;
                    sumKapasitas += stats.kapasitas;
                    sumRefleksi += stats.refleksi;
                    sumIpk += stats.ipk;
                    sumRespondentCount += stats.respondent_count;
                    stats.q_averages.forEach((val, idx) => {
                        qAverages[idx] += val;
                    });
                    projectCountForRel++;
                }
            });

            if (projectCountForRel > 0) {
                qAverages = qAverages.map(val => val / projectCountForRel);
                activeStats = {
                    dampak: sumDampak / projectCountForRel,
                    peran: sumPeran / projectCountForRel,
                    kapasitas: sumKapasitas / projectCountForRel,
                    refleksi: sumRefleksi / projectCountForRel,
                    ipk: sumIpk / projectCountForRel,
                    respondent_count: sumRespondentCount,
                    q_averages: qAverages
                };
            }
        } else {
            activeStats = activeRel === 'overall' ? lpData.overall : lpData.by_relation[activeRel];
        }

        if (!activeStats) return;

        // Set total respondents in the header
        document.getElementById('leadpro-respondent-count').textContent = activeStats.respondent_count;

        const pctDampak = (activeStats.dampak / 4) * 100;
        const pctPeran = (activeStats.peran / 4) * 100;
        const pctKapasitas = (activeStats.kapasitas / 4) * 100;
        const pctRefleksi = (activeStats.refleksi / 4) * 100;
        const pctIpk = (activeStats.ipk / 4) * 100;

        const valDampak = activeStats.dampak;
        const valPeran = activeStats.peran;
        const valKapasitas = activeStats.kapasitas;
        const valRefleksi = activeStats.refleksi;

        // Populating Leadpro Scorecards (5 cards: Capaian Proyek + 4 Dimensions)
        const scorecardsContainer = document.getElementById('leadpro-scorecards-container');
        scorecardsContainer.innerHTML = '';

        const cards = [
            {
                name: 'Persentase Capaian Proyek',
                icon: 'award',
                score: pctIpk,
                isIpk: true,
                badge: getLeadproBadge(pctIpk),
                color: 'var(--primary)',
                desc: 'Akumulasi rata-rata seluruh indikator proyek'
            },
            {
                name: 'Dampak Proyek (Q1-Q7)',
                icon: 'globe',
                score: pctDampak,
                isIpk: false,
                color: 'var(--info)',
                desc: 'Kemanfaatan aksi nyata untuk masyarakat sasaran'
            },
            {
                name: 'Peran Kepemimpinan (Q8-Q12)',
                icon: 'users',
                score: pctPeran,
                isIpk: false,
                color: 'var(--success)',
                desc: 'Kapasitas mengelola tim dan koordinasi mitra'
            },
            {
                name: 'Kapasitas Pribadi (Q13-Q17)',
                icon: 'brain',
                score: pctKapasitas,
                isIpk: false,
                color: 'var(--warning)',
                desc: 'Peningkatan kompetensi kepemimpinan personal'
            },
            {
                name: 'Keberlanjutan (Q18-Q22)',
                icon: 'refresh-cw',
                score: pctRefleksi,
                isIpk: false,
                color: 'var(--accent)',
                desc: 'Rencana jangka panjang dan keberlanjutan aksi'
            }
        ];

        cards.forEach(c => {
            const pct = c.score;
            scorecardsContainer.innerHTML += `
                <div class="card text-center" style="display: flex; flex-direction: column; justify-content: space-between; padding: 20px; margin-bottom: 0;">
                    <div>
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: var(--text-primary); margin-bottom: 16px; font-size: 0.9rem;">
                            <i data-lucide="${c.icon}" size="16" style="color: ${c.color};"></i>
                            <span>${c.name}</span>
                        </div>
                        <div class="score-box" style="margin-bottom: 12px;">
                            <div class="score-num" style="${c.isIpk ? 'color: var(--primary);' : 'color: var(--text-primary); font-size: 2rem;'}">${c.score.toFixed(2)}%</div>
                            <div class="score-lbl">${c.isIpk ? 'Persentase Capaian' : 'Skor Capaian'}</div>
                            ${c.isIpk ? `<div style="margin-top: 8px;">${c.badge}</div>` : ''}
                        </div>
                    </div>
                    <div>
                        ${!c.isIpk ? `
                            <div class="progress-track" style="margin-bottom: 12px; height: 6px; background-color: var(--bg-tertiary);">
                                <div class="progress-bar" style="width: ${pct}%; background-color: ${c.color}; height: 100%; border-radius: 4px;"></div>
                            </div>
                        ` : ''}
                        <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; line-height: 1.3;">
                            ${c.desc}
                        </div>
                    </div>
                </div>
            `;
        });

        // Render AI Suggestions
        const suggestions = getLeadproSuggestions(valDampak, valPeran, valKapasitas, valRefleksi);
        document.getElementById('suggest-dampak').textContent = suggestions.dampak;
        document.getElementById('suggest-peran').textContent = suggestions.peran;
        document.getElementById('suggest-kapasitas').textContent = suggestions.kapasitas;
        document.getElementById('suggest-refleksi').textContent = suggestions.refleksi;

        // Clean up chart references since charts are removed
        destroyChart('leadproRadar');
        destroyChart('leadproRelations');

        lucide.createIcons();
    }


    // ==========================================
    // TAB 5: MATRIKS PENILAIAN LOGIC
    // ==========================================
    const matriksSearch = document.getElementById('matriks-search');
    
    matriksSearch.addEventListener('input', (e) => {
        state.matriksSearchQuery = e.target.value.toLowerCase();
        state.matriksCurrentPage = 1;
        renderMatriksTab();
    });

    // Handle column sorting
    window.sortTable = function(colIndex) {
        if (state.matriksSortColumn === colIndex) {
            state.matriksSortAscending = !state.matriksSortAscending;
        } else {
            state.matriksSortColumn = colIndex;
            state.matriksSortAscending = true;
        }
        
        // Update header indicator icons
        const headers = document.querySelectorAll('#table-matriks th');
        headers.forEach((th, idx) => {
            const icon = th.querySelector('i');
            if (icon) {
                if (idx === colIndex) {
                    icon.setAttribute('data-lucide', state.matriksSortAscending ? 'chevron-up' : 'chevron-down');
                } else {
                    icon.setAttribute('data-lucide', 'chevrons-up-down');
                }
            }
        });
        lucide.createIcons();

        renderMatriksTab();
    };

    window.selectAwardeeFromTable = function(name) {
        // Change selection
        const awardee = data.assessments[name];
        if (awardee) {
            filterWilayah.value = awardee.region;
            state.selectedRegion = awardee.region;
            updateAwardeeDropdown();
            filterAwardee.value = name;
            state.selectedAwardee = name;
            
            // Redirect to self-assessment
            const selfTab = document.querySelector('[data-tab="self-assessment"]');
            selfTab.click();
        }
    };

    window.prevPage = function() {
        if (state.matriksCurrentPage > 1) {
            state.matriksCurrentPage--;
            renderMatriksTab();
        }
    };

    window.nextPage = function() {
        const list = getFilteredMatriksList();
        const maxPage = Math.ceil(list.length / state.matriksRowsPerPage);
        if (state.matriksCurrentPage < maxPage) {
            state.matriksCurrentPage++;
            renderMatriksTab();
        }
    };

    function getFilteredMatriksList() {
        let list = Object.values(data.assessments);
        
        // Search filter
        if (state.matriksSearchQuery) {
            list = list.filter(aw => 
                aw.name.toLowerCase().includes(state.matriksSearchQuery) ||
                aw.campus.toLowerCase().includes(state.matriksSearchQuery)
            );
        }

        // Sort data
        list.sort((a, b) => {
            let valA, valB;
            switch(state.matriksSortColumn) {
                case 0: // Nama
                    valA = a.name; valB = b.name;
                    break;
                case 1: // Region
                    valA = a.region; valB = b.region;
                    break;
                case 2: // Campus
                    valA = a.campus; valB = b.campus;
                    break;
                case 3: // IPK Awal
                    valA = a.stats['Asesmen Awal']?.ipk ?? -1;
                    valB = b.stats['Asesmen Awal']?.ipk ?? -1;
                    break;
                case 4: // IPK Tengah
                    valA = a.stats['Asesmen Tengah']?.ipk ?? -1;
                    valB = b.stats['Asesmen Tengah']?.ipk ?? -1;
                    break;
                case 5: // IPK Peer
                    valA = a.stats['Peer Awardee']?.ipk ?? -1;
                    valB = b.stats['Peer Awardee']?.ipk ?? -1;
                    break;
                case 6: // IPK Manajer
                    valA = a.stats['Manajer Wilayah']?.ipk ?? -1;
                    valB = b.stats['Manajer Wilayah']?.ipk ?? -1;
                    break;
                case 7: // IPK Jejaring
                    valA = a.stats['Jejaring Eksternal']?.ipk ?? -1;
                    valB = b.stats['Jejaring Eksternal']?.ipk ?? -1;
                    break;
                case 8: // IPK Leadpro
                    valA = data.leadpro[a.name]?.overall?.ipk ?? -1;
                    valB = data.leadpro[b.name]?.overall?.ipk ?? -1;
                    break;
                default:
                    valA = a.name; valB = b.name;
            }

            if (typeof valA === 'string') {
                return state.matriksSortAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return state.matriksSortAscending ? valA - valB : valB - valA;
            }
        });

        return list;
    }

    function renderMatriksTab() {
        const filteredList = getFilteredMatriksList();
        const total = filteredList.length;
        
        // Paginate
        const start = (state.matriksCurrentPage - 1) * state.matriksRowsPerPage;
        const end = Math.min(start + state.matriksRowsPerPage, total);
        const paginatedList = filteredList.slice(start, end);

        const tableBody = document.getElementById('matriks-table-body');
        tableBody.innerHTML = '';

        if (paginatedList.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding: 24px;">Tidak ada data awardee ditemukan.</td></tr>`;
            document.getElementById('matriks-pagination-info').textContent = 'Menampilkan 0-0 dari 0 Awardee';
            return;
        }

        paginatedList.forEach(aw => {
            const ipkAwal = aw.stats['Asesmen Awal']?.ipk;
            const ipkTengah = aw.stats['Asesmen Tengah']?.ipk;
            const ipkPeer = aw.stats['Peer Awardee']?.ipk;
            const ipkManager = aw.stats['Manajer Wilayah']?.ipk;
            const ipkJejaring = aw.stats['Jejaring Eksternal']?.ipk;
            
            const leadpro = data.leadpro[aw.name];
            const ipkLeadpro = leadpro?.overall?.ipk;

            tableBody.innerHTML += `
                <tr onclick="selectAwardeeFromTable('${aw.name}')">
                    <td><strong>${aw.name}</strong></td>
                    <td>${aw.region}</td>
                    <td>${aw.campus}</td>
                    <td>${ipkAwal ? ipkAwal.toFixed(2) : '-'}</td>
                    <td>${ipkTengah ? ipkTengah.toFixed(2) : '-'}</td>
                    <td>${ipkPeer ? ipkPeer.toFixed(2) : '-'}</td>
                    <td>${ipkManager ? ipkManager.toFixed(2) : '-'}</td>
                    <td>${ipkJejaring ? ipkJejaring.toFixed(2) : '-'}</td>
                    <td><strong>${ipkLeadpro ? ((ipkLeadpro / 4) * 100).toFixed(2) + '%' : '-'}</strong></td>
                    <td>
                        <button class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 0.75rem;">
                            Detail
                        </button>
                    </td>
                </tr>
            `;
        });

        document.getElementById('matriks-pagination-info').textContent = `Menampilkan ${start + 1}-${end} dari ${total} Awardee`;

        // Update disabled state for pagination buttons
        const maxPage = Math.ceil(total / state.matriksRowsPerPage);
        document.getElementById('matriks-prev-btn').disabled = state.matriksCurrentPage === 1;
        document.getElementById('matriks-next-btn').disabled = state.matriksCurrentPage >= maxPage;
    }


    // ==========================================
    // TAB 6: INSTRUMEN EXPLORER LOGIC
    // ==========================================
    window.toggleAccordion = function(headerElement) {
        const item = headerElement.parentElement;
        const isOpen = item.classList.contains('open');
        
        // Close all items first (optional, but clean)
        const allItems = item.parentElement.querySelectorAll('.accordion-item');
        allItems.forEach(i => i.classList.remove('open'));
        
        if (!isOpen) {
            item.classList.add('open');
        }
    };

    function calculateGlobalQuestionAverages() {
        // We will calculate:
        // - For each of the 50 assessment questions: global average score across all rows in 'Assesment'
        // - For each of the 22 leadpro questions: global average score across all rows in 'Leadpro'
        
        const qAssessSums = Array(50).fill(0);
        const qAssessCounts = Array(50).fill(0);
        
        // Loop through all awardees and their categories
        Object.values(data.assessments).forEach(aw => {
            Object.values(aw.stats).forEach(catStats => {
                if (catStats && catStats.q_averages) {
                    catStats.q_averages.forEach((score, idx) => {
                        qAssessSums[idx] += score * catStats.respondent_count;
                        qAssessCounts[idx] += catStats.respondent_count;
                    });
                }
            });
        });

        const qLeadproSums = Array(22).fill(0);
        const qLeadproCounts = Array(22).fill(0);
        Object.values(data.leadpro).forEach(lp => {
            if (lp.overall && lp.overall.q_averages) {
                lp.overall.q_averages.forEach((score, idx) => {
                    qLeadproSums[idx] += score * lp.overall.respondent_count;
                    qLeadproCounts[idx] += lp.overall.respondent_count;
                });
            }
        });

        return {
            assess: qAssessSums.map((sum, idx) => qAssessCounts[idx] > 0 ? sum / qAssessCounts[idx] : 0),
            leadpro: qLeadproSums.map((sum, idx) => qLeadproCounts[idx] > 0 ? sum / qLeadproCounts[idx] : 0)
        };
    }

    const globalAverages = calculateGlobalQuestionAverages();

    function renderInstrumenTab() {
        const assessList = document.getElementById('instrumen-assess-list');
        const leadproList = document.getElementById('instrumen-leadpro-list');
        
        const queryAssess = document.getElementById('instrumen-assess-search').value.toLowerCase();
        const queryLeadpro = document.getElementById('instrumen-leadpro-search').value.toLowerCase();

        // 1. Assessment List
        assessList.innerHTML = '';
        data.questions.assessment.forEach((q, idx) => {
            const globalAvg = globalAverages.assess[idx];
            const textMatch = q.self_text.toLowerCase().includes(queryAssess) || q.public_text.toLowerCase().includes(queryAssess);
            const codeMatch = q.code.toLowerCase().includes(queryAssess);
            
            if (queryAssess === '' || textMatch || codeMatch) {
                assessList.innerHTML += `
                    <div class="instrument-item">
                        <span class="instrument-code">${q.code}</span>
                        <div style="flex:1;">
                            <div class="q-detail-header">
                                <span style="font-size:0.75rem; font-weight:600; color:var(--text-muted);">Variabel: ${getVariableNameForAssessIndex(idx)}</span>
                                <span style="font-size:0.8rem; font-weight:600; color:var(--primary);">Nasional Avg: <strong>${globalAvg.toFixed(2)}</strong></span>
                            </div>
                            <p style="font-size:0.85rem; margin-top:4px;"><strong>Self:</strong> "${q.self_text}"</p>
                            <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;"><strong>Publik:</strong> "${q.public_text}"</p>
                        </div>
                    </div>
                `;
            }
        });

        // 2. Leadpro List
        leadproList.innerHTML = '';
        data.questions.leadpro.forEach((q, idx) => {
            const globalAvg = globalAverages.leadpro[idx];
            const textMatch = (q.public_text || '').toLowerCase().includes(queryLeadpro);
            const codeMatch = q.code.toLowerCase().includes(queryLeadpro);
            
            if (queryLeadpro === '' || textMatch || codeMatch) {
                leadproList.innerHTML += `
                    <div class="instrument-item">
                        <span class="instrument-code" style="background-color: var(--secondary);">${q.code}</span>
                        <div style="flex:1;">
                            <div class="q-detail-header">
                                <span style="font-size:0.75rem; font-weight:600; color:var(--text-muted);">Dimensi: ${getVariableNameForLeadproIndex(idx)}</span>
                                <span style="font-size:0.8rem; font-weight:600; color:var(--secondary);">Nasional Avg: <strong>${((globalAvg / 4) * 100).toFixed(2)}%</strong></span>
                            </div>
                            <p style="font-size:0.85rem; margin-top:4px;">"${q.public_text || ''}"</p>
                        </div>
                    </div>
                `;
            }
        });
    }

    function getVariableNameForAssessIndex(idx) {
        if (idx < 19) return "Self Maturity (Q1-Q19)";
        if (idx < 39) return "Competency Enrichment (Q20-Q39)";
        return "Bringing Inspiration (Q40-Q50)";
    }

    function getVariableNameForLeadproIndex(idx) {
        if (idx < 7) return "Dampak Leadership Project (Q1-Q7)";
        if (idx < 12) return "Peran & Pengalaman (Q8-Q12)";
        if (idx < 17) return "Pengembangan Kapasitas (Q13-Q17)";
        return "Refleksi & Rencana (Q18-Q22)";
    }

    window.filterInstruments = function(type) {
        renderInstrumenTab();
    };


    // ==========================================
    // Initial Render execution
    // ==========================================
    updateHeaderUI();
    renderActiveTab();
});
