export function reconstructSurveyData(rawAssesment, rawInstrumenAssesment, rawLeadpro, rawInstrumenLeadpro) {
    const data = {
        assessments: {},
        leadpro: {},
        questions: {
            assessment: [],
            leadpro: []
        }
    };

    // 1. Process Questions
    rawInstrumenAssesment.forEach(row => {
        if (!row.Kode) return;
        data.questions.assessment.push({
            code: row.Kode,
            self_text: row["Pertanyaan Assesmen Awal & Tengah"] || "",
            public_text: row["Pertanyaan Manajer Wilayah dan Jejaring Eksternal"] || ""
        });
    });

    rawInstrumenLeadpro.forEach(row => {
        if (!row.Kode) return;
        data.questions.leadpro.push({
            code: row.Kode,
            self_text: null,
            public_text: row["Pertanyaan"] || ""
        });
    });

    // 2. Process Assessments (Raw responses per respondent)
    rawAssesment.forEach(row => {
        const name = row["Nama Awardee"];
        if (!name) return;

        if (!data.assessments[name]) {
            data.assessments[name] = {
                name: name,
                region: row["Wilayah"] || "",
                campus: row["Kampus"] || "",
                stats: {}
            };
        }

        const category = row["Kategori"]; // e.g., "Asesmen Awal", "Asesmen Tengah", "Peer Awardee", etc.
        if (!category) return;

        if (!data.assessments[name].stats[category]) {
            data.assessments[name].stats[category] = {
                respondent_count: 0,
                q_sums: Array(50).fill(0),
                q_counts: Array(50).fill(0),
                q_averages: Array(50).fill(0),
                self_maturity: 0,
                competency_enrichment: 0,
                bringing_inspiration: 0,
                ipk: 0
            };
        }

        const stat = data.assessments[name].stats[category];
        stat.respondent_count += 1;

        // Sum up question scores (Q1 to Q50)
        for (let i = 1; i <= 50; i++) {
            const val = parseFloat(row[`Q${i}`]);
            if (!isNaN(val)) {
                stat.q_sums[i - 1] += val;
                stat.q_counts[i - 1] += 1;
            }
        }

        // Extract qualitative feedback (Saran Diri and Saran Program)
        const cleanSaranDiri = (row["Saran Diri"] || "").toString().trim();
        const cleanSaranProgram = (row["Saran Program"] || "").toString().trim();
        
        const hasSaranDiri = cleanSaranDiri && cleanSaranDiri !== "-";
        const hasSaranProgram = cleanSaranProgram && cleanSaranProgram !== "-";

        if (hasSaranDiri || hasSaranProgram) {
            if (!data.assessments[name].saran) {
                data.assessments[name].saran = [];
            }
            data.assessments[name].saran.push({
                category: category,
                saran_diri: hasSaranDiri ? cleanSaranDiri : null,
                saran_program: hasSaranProgram ? cleanSaranProgram : null
            });
        }
    });

    // Post-process Assessments to calculate averages
    Object.values(data.assessments).forEach(aw => {
        Object.entries(aw.stats).forEach(([category, stat]) => {
            // Calculate q_averages
            for (let i = 0; i < 50; i++) {
                stat.q_averages[i] = stat.q_counts[i] > 0 ? (stat.q_sums[i] / stat.q_counts[i]) : 0;
            }

            // self_maturity: average of Q1-Q19 (index 0 to 18)
            let sumSM = 0, countSM = 0;
            for (let i = 0; i < 19; i++) {
                if (stat.q_counts[i] > 0) {
                    sumSM += stat.q_averages[i];
                    countSM++;
                }
            }
            stat.self_maturity = countSM > 0 ? parseFloat((sumSM / countSM).toFixed(3)) : 0;

            // competency_enrichment: average of Q20-Q39 (index 19 to 38)
            let sumCE = 0, countCE = 0;
            for (let i = 19; i < 39; i++) {
                if (stat.q_counts[i] > 0) {
                    sumCE += stat.q_averages[i];
                    countCE++;
                }
            }
            stat.competency_enrichment = countCE > 0 ? parseFloat((sumCE / countCE).toFixed(3)) : 0;

            // bringing_inspiration: average of Q40-Q50 (index 39 to 49)
            let sumBI = 0, countBI = 0;
            for (let i = 39; i < 50; i++) {
                if (stat.q_counts[i] > 0) {
                    sumBI += stat.q_averages[i];
                    countBI++;
                }
            }
            stat.bringing_inspiration = countBI > 0 ? parseFloat((sumBI / countBI).toFixed(3)) : 0;

            // ipk = average of self_maturity, competency_enrichment, bringing_inspiration
            stat.ipk = parseFloat(((stat.self_maturity + stat.competency_enrichment + stat.bringing_inspiration) / 3).toFixed(3));

            // Clean up temporary variables
            delete stat.q_sums;
            delete stat.q_counts;
        });
    });

    // 3. Process Leadpro (Raw responses per respondent)
    rawLeadpro.forEach(row => {
        const name = row["Nama Awardee"];
        if (!name) return;

        if (!data.leadpro[name]) {
            data.leadpro[name] = {
                project: row["Project"] || "",
                overall: {
                    respondent_count: 0,
                    q_sums: Array(22).fill(0),
                    q_counts: Array(22).fill(0),
                    q_averages: Array(22).fill(0),
                    dampak: 0,
                    peran: 0,
                    kapasitas: 0,
                    refleksi: 0,
                    ipk: 0
                },
                by_relation: {}
            };
        }

        const lp = data.leadpro[name];
        const relation = row["Hubungan"];

        // Helper to update a stats object
        const updateLpStats = (stat) => {
            stat.respondent_count += 1;
            for (let i = 1; i <= 22; i++) {
                const val = parseFloat(row[`Q${i}`]);
                if (!isNaN(val)) {
                    stat.q_sums[i - 1] += val;
                    stat.q_counts[i - 1] += 1;
                }
            }
        };

        // Update overall
        updateLpStats(lp.overall);

        // Update by_relation
        if (relation) {
            if (!lp.by_relation[relation]) {
                lp.by_relation[relation] = {
                    respondent_count: 0,
                    q_sums: Array(22).fill(0),
                    q_counts: Array(22).fill(0),
                    q_averages: Array(22).fill(0),
                    dampak: 0,
                    peran: 0,
                    kapasitas: 0,
                    refleksi: 0,
                    ipk: 0
                };
            }
            updateLpStats(lp.by_relation[relation]);
        }

        // Extract qualitative feedback (Pesan, Kritik, and Saran)
        const cleanPesan = (row["Pesan"] || "").toString().trim();
        const cleanKritik = (row["Kritik"] || "").toString().trim();
        const cleanSaran = (row["Saran"] || "").toString().trim();

        const hasPesan = cleanPesan && cleanPesan !== "-";
        const hasKritik = cleanKritik && cleanKritik !== "-";
        const hasSaran = cleanSaran && cleanSaran !== "-";

        if (hasPesan || hasKritik || hasSaran) {
            if (!lp.feedback) {
                lp.feedback = [];
            }
            lp.feedback.push({
                hubungan: relation || "Tidak Diketahui",
                pesan: hasPesan ? cleanPesan : null,
                kritik: hasKritik ? cleanKritik : null,
                saran: hasSaran ? cleanSaran : null
            });
        }
    });

    // Helper to calculate Leadpro scores
    const calculateLpScores = (stat) => {
        for (let i = 0; i < 22; i++) {
            stat.q_averages[i] = stat.q_counts[i] > 0 ? (stat.q_sums[i] / stat.q_counts[i]) : 0;
        }

        // dampak: average of Q1-Q7 (index 0 to 6)
        let sumD = 0, countD = 0;
        for (let i = 0; i < 7; i++) {
            if (stat.q_counts[i] > 0) {
                sumD += stat.q_averages[i];
                countD++;
            }
        }
        stat.dampak = countD > 0 ? parseFloat((sumD / countD).toFixed(3)) : 0;

        // peran: average of Q8-Q12 (index 7 to 11)
        let sumP = 0, countP = 0;
        for (let i = 7; i < 12; i++) {
            if (stat.q_counts[i] > 0) {
                sumP += stat.q_averages[i];
                countP++;
            }
        }
        stat.peran = countP > 0 ? parseFloat((sumP / countP).toFixed(3)) : 0;

        // kapasitas: average of Q13-Q17 (index 12 to 16)
        let sumK = 0, countK = 0;
        for (let i = 12; i < 17; i++) {
            if (stat.q_counts[i] > 0) {
                sumK += stat.q_averages[i];
                countK++;
            }
        }
        stat.kapasitas = countK > 0 ? parseFloat((sumK / countK).toFixed(3)) : 0;

        // refleksi: average of Q18-Q22 (index 17 to 21)
        let sumR = 0, countR = 0;
        for (let i = 17; i < 22; i++) {
            if (stat.q_counts[i] > 0) {
                sumR += stat.q_averages[i];
                countR++;
            }
        }
        stat.refleksi = countR > 0 ? parseFloat((sumR / countR).toFixed(3)) : 0;

        // ipk: average of dampak, peran, kapasitas, refleksi
        stat.ipk = parseFloat(((stat.dampak + stat.peran + stat.kapasitas + stat.refleksi) / 4).toFixed(3));

        delete stat.q_sums;
        delete stat.q_counts;
    };

    // Post-process Leadpro to calculate averages
    Object.values(data.leadpro).forEach(lp => {
        calculateLpScores(lp.overall);
        Object.values(lp.by_relation).forEach(stat => {
            calculateLpScores(stat);
        });
    });

    return data;
}
