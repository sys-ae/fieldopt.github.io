// The scroll story: one recorded FieldOpt demo day (data/day.json), replayed against scroll
// position. Statuses come straight from the engine's frames; techs move only between their
// recorded departure and arrival.
(async function () {
	const $ = (id) => document.getElementById(id);
	const nav = $("nav");
	addEventListener("scroll", () => nav.classList.toggle("solid", scrollY > 40), { passive: true });

	let day;
	try { day = await (await fetch("/data/day.json")).json(); } catch { return; }

	const min = (s) => s ? +s.slice(0, 2) * 60 + +s.slice(3, 5) : null;
	const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.floor(m % 60)).padStart(2, "0");
	const DAY0 = min(day.frames[0].t), DAY1 = min(day.frames[day.frames.length - 1].t);
	const frameAt = (m) => day.frames[Math.max(0, Math.min(day.frames.length - 1, Math.round((m - DAY0) / 2)))];

	// --- Copy that quotes the recording ---
	const morning = day.jobs.filter((j) => min(j.born) <= DAY0);
	const vip = day.jobs.find((j) => min(j.born) > DAY0);
	const show = day.jobs.find((j) => j.id === 1 && j.q.length >= 2) || morning.find((j) => j.q.length >= 2 && j.q.length <= 5);
	const names = (idx) => idx.map((i) => day.techs[i].name);
	const list = (a) => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
	const words = ["no", "one", "two", "three", "four", "five", "six"];
	const fill = {
		routeMs: day.routeMs,
		morningJobs: morning.length,
		done: day.done,
		onTime: day.onTime,
		miles: day.miles ?? "—",
		endTime: day.frames[day.frames.length - 1].t,
		showcase: show ? `${show.c} needs ${/^[aeiou]/.test(show.type) ? "an" : "a"} ${show.type.replace("_", " ")}: ${words[show.q.length] || show.q.length} techs qualify — ${list(names(show.q))}.` : "",
	};
	document.querySelectorAll("[data-fill]").forEach((el) => { el.textContent = fill[el.dataset.fill]; });

	// --- Map ---
	const map = L.map("map", {
		zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
		boxZoom: false, keyboard: false, touchZoom: false, tap: false, zoomSnap: 0.25,
	});
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 18, attribution: "&copy; OpenStreetMap contributors",
	}).addTo(map);
	const bounds = L.latLngBounds([...day.jobs, ...day.techs].map((p) => [p.lat, p.lng]));
	function fit() {
		const phone = innerWidth <= 640;
		map.fitBounds(bounds, phone
			? { paddingTopLeft: [16, 150], paddingBottomRight: [16, innerHeight * 0.42] }
			: { paddingTopLeft: [Math.min(560, innerWidth * 0.42), 90], paddingBottomRight: [Math.min(320, innerWidth * 0.2), 50] });
	}
	fit();
	addEventListener("resize", () => { fit(); queue(); });

	const setClass = (layer, cls) => { const el = layer.getElement(); if (el && el.getAttribute("class") !== cls) el.setAttribute("class", cls); };

	// Tech legs: depart = arrival - travel, so a tech is only ever seen moving when the engine
	// says they were on the road.
	const legs = day.techs.map(() => []);
	for (const j of day.jobs) {
		if (j.tech == null || !j.start) continue;
		const arrive = min(j.start);
		legs[j.tech].push({ depart: arrive - Math.max(1, j.travel || 0), arrive, lat: j.lat, lng: j.lng });
	}
	legs.forEach((l) => l.sort((a, b) => a.arrive - b.arrive));
	function techAt(i, m) {
		let lat = day.techs[i].lat, lng = day.techs[i].lng;
		for (const leg of legs[i]) {
			if (m < leg.depart) break;
			if (m < leg.arrive) {
				const k = (m - leg.depart) / (leg.arrive - leg.depart);
				return [lat + (leg.lat - lat) * k, lng + (leg.lng - lng) * k];
			}
			lat = leg.lat; lng = leg.lng;
		}
		return [lat, lng];
	}

	const routes = day.techs.map((t, i) => L.polyline([[t.lat, t.lng], ...legs[i].map((l) => [l.lat, l.lng])],
		{ className: "route", interactive: false }).addTo(map));
	const qlines = show ? show.q.map((i) => L.polyline([[show.lat, show.lng], [day.techs[i].lat, day.techs[i].lng]],
		{ className: "qline", interactive: false })) : [];
	const jobDots = new Map(day.jobs.map((j) => [j.id, L.circleMarker([j.lat, j.lng],
		{ radius: j === vip ? 7 : 5, className: "job s-p", interactive: false }).addTo(map)]));
	const techDots = day.techs.map((t) => L.circleMarker([t.lat, t.lng], { radius: 4.5, className: "tech", interactive: false }).addTo(map));

	// Routes are revealed in the order the morning was planned: by each tech's first job.
	const routeOrder = day.techs.map((_, i) => i).filter((i) => legs[i].length)
		.sort((a, b) => legs[a][0].arrive - legs[b][0].arrive);

	// --- Day captions, keyed to the recorded clock ---
	const vipAt = vip ? min(vip.born) : Infinity;
	const captions = [
		[DAY0, "Then the day happens.", "Techs leave when they need to — not all at eight. Pins turn purple on arrival and green when the work is done."],
		[vipAt, `${hhmm(vipAt)} — an emergency.`, vip ? `A priority-one ${vip.type.replace("_", " ")} lands at ${vip.c.replace(/\s+—.*$/, "")}. It waits for the first qualified tech to free up, instead of pulling someone off a job.` : ""],
		[Math.max(vipAt + 70, 12 * 60), "Breaks and lunch are part of the plan.", "Staggered breaks and lunches are respected: nobody on a break gets dispatched, so the work waits or goes to someone else."],
		[16 * 60, "The day winds down.", "Shifts end and techs go off duty as their last job closes. Every status on this map is the engine's own."],
	];
	if (vip && vip.start) {
		const who = vip.tech != null ? day.techs[vip.tech].name : "A qualified tech";
		captions.push([min(vip.start), `${vip.start} — the emergency is covered.`,
			`${who} frees up and takes it, running into overtime: priority one may. Routine work never gets booked past a tech's shift.`]);
		captions.sort((a, b) => a[0] - b[0]);
	}

	// --- Render ---
	const steps = [...document.querySelectorAll(".step")];
	const hud = $("hud");
	function progress(el) {
		const r = el.getBoundingClientRect();
		const span = r.height - innerHeight * 0.6;
		return Math.max(0, Math.min(1, (innerHeight * 0.3 - r.top) / Math.max(1, span)));
	}
	function activeStep() {
		const y = innerHeight * 0.55;
		let cur = steps[0];
		for (const s of steps) if (s.getBoundingClientRect().top <= y) cur = s;
		return cur;
	}
	function counts(statuses) {
		const n = { p: 0, a: 0, i: 0, c: 0 };
		for (const s of statuses) if (s in n) n[s]++;
		for (const k in n) $("n-" + k).textContent = n[k];
	}

	function render() {
		const step = activeStep();
		const name = step.dataset.step;
		hud.classList.toggle("on", name !== "hero");
		const focus = name === "rules" && show;
		qlines.forEach((l) => focus ? l.addTo(map) : l.remove());

		if (name === "hero" || name === "morning" || name === "rules") {
			$("hud-clock").textContent = hhmm(DAY0 - 1);
			for (const j of day.jobs) {
				const hidden = j === vip;
				setClass(jobDots.get(j.id), "job s-p" + (hidden ? " hide" : focus ? (j === show ? " focus" : " dim") : ""));
			}
			techDots.forEach((d, i) => { d.setLatLng([day.techs[i].lat, day.techs[i].lng]); setClass(d, "tech" + (focus && !show.q.includes(i) ? " dim" : focus ? " focus" : "")); });
			routes.forEach((r) => setClass(r, "route"));
			counts(morning.map(() => "p"));
			return;
		}

		if (name === "route") {
			const k = Math.round(progress(step) * routeOrder.length);
			const on = new Set(routeOrder.slice(0, k));
			$("hud-clock").textContent = hhmm(DAY0);
			routes.forEach((r, i) => setClass(r, on.has(i) ? "route on" : "route"));
			let routed = 0;
			const st = [];
			for (const j of day.jobs) {
				if (j === vip) { setClass(jobDots.get(j.id), "job hide"); continue; }
				const a = j.tech != null && on.has(j.tech);
				if (a) routed++;
				st.push(a ? "a" : "p");
				setClass(jobDots.get(j.id), a ? "job s-a" : "job s-p");
			}
			techDots.forEach((d, i) => { d.setLatLng([day.techs[i].lat, day.techs[i].lng]); setClass(d, "tech"); });
			$("routed").textContent = routed;
			counts(st);
			return;
		}

		// day + end: replay the recorded frames
		const m = name === "end" ? DAY1 : DAY0 + progress(step) * (DAY1 - DAY0);
		const f = frameAt(m);
		$("hud-clock").textContent = hhmm(m);
		const st = [];
		for (const j of day.jobs) {
			const v = f.j[j.id];
			if (!v) { setClass(jobDots.get(j.id), "job hide"); continue; }
			const s = v[0];
			st.push(s);
			setClass(jobDots.get(j.id), "job s-" + s + (j === vip && s !== "c" ? " vip" : ""));
		}
		techDots.forEach((d, i) => { d.setLatLng(techAt(i, m)); setClass(d, "tech"); });
		routes.forEach((r) => setClass(r, "route faint"));
		counts(st);

		if (name === "day") {
			let c = captions[0];
			for (const cap of captions) if (m >= cap[0]) c = cap;
			$("day-time").textContent = hhmm(m);
			if ($("day-title").textContent !== c[1]) { $("day-title").textContent = c[1]; $("day-text").textContent = c[2]; }
		}
	}

	let pending = false;
	function queue() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }
	addEventListener("scroll", queue, { passive: true });
	map.whenReady(() => setTimeout(render, 0));
	render();
})();
