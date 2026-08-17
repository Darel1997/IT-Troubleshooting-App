import React, { useState, useRef, useEffect, useMemo } from "react";

/* ============================================================================
   IT TROUBLESHOOTING LAB
   A simulated desktop-support environment. Nothing here touches a real shell:
   every command is answered by the deterministic simulator below, driven by a
   per-scenario machine profile (`sim`).
   ========================================================================== */

/* ---------------------------------------------------------------- utilities */
const clock = (d = new Date()) =>
  d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

/* ------------------------------------------------------- command simulator  */
function adapterBlock(a, all) {
  if (a.status === "disconnected") {
    return `${a.type} adapter ${a.name}:

   Media State . . . . . . . . . . . : Media disconnected
   Connection-specific DNS Suffix  . : `;
  }
  let s = `${a.type} adapter ${a.name}:

   Connection-specific DNS Suffix  . : ${a.suffix || "corp.local"}`;
  if (all)
    s += `
   Description . . . . . . . . . . . : ${a.desc}
   Physical Address. . . . . . . . . : ${a.mac}
   DHCP Enabled. . . . . . . . . . . : ${a.dhcp ? "Yes" : "No"}
   Autoconfiguration Enabled . . . . : Yes`;
  s += `
   IPv4 Address. . . . . . . . . . . : ${a.ip}(Preferred)
   Subnet Mask . . . . . . . . . . . : ${a.mask}`;
  if (all && a.lease)
    s += `
   Lease Obtained. . . . . . . . . . : ${a.lease}
   Lease Expires . . . . . . . . . . : ${a.expires || "-"}`;
  s += `
   Default Gateway . . . . . . . . . : ${a.gw || ""}`;
  if (all) {
    s += `
   DHCP Server . . . . . . . . . . . : ${a.dhcpServer || "N/A"}`;
    const dns = a.dns && a.dns.length ? a.dns : [""];
    s += `
   DNS Servers . . . . . . . . . . . : ${dns.join("\n                                       ")}`;
    if (a.dnsStatic)
      s += `
   NetBIOS over Tcpip. . . . . . . . : Enabled`;
  }
  return s;
}

function reachable(sim, ip) {
  if (ip === "127.0.0.1" || ip === sim.adapter.ip) return true;
  const m = sim.reach || {};
  if (Object.prototype.hasOwnProperty.call(m, ip)) return m[ip];
  if (ip === sim.adapter.gw) return m.gateway !== undefined ? m.gateway : true;
  return m.default !== undefined ? m.default : true;
}

function resolveName(sim, name) {
  const table = sim.resolve || {};
  const key = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  if (sim.dns === "ok") return "93.184.216.34";
  return null;
}

function cmdPing(sim, target) {
  const a = sim.adapter;
  if (a.status === "disconnected")
    return `Ping request could not find host ${target}. Please check the name and try again.`;
  let ip = target;
  if (!isIp(target)) {
    const r = resolveName(sim, target);
    if (!r || sim.dns === "fail")
      return `Ping request could not find host ${target}. Please check the name and try again.`;
    ip = r;
  }
  if (a.apipa && ip !== a.ip && ip !== "127.0.0.1") {
    return `Pinging ${ip} with 32 bytes of data:
Reply from ${a.ip}: Destination host unreachable.
Reply from ${a.ip}: Destination host unreachable.
Reply from ${a.ip}: Destination host unreachable.
Reply from ${a.ip}: Destination host unreachable.

Ping statistics for ${ip}:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),`;
  }
  const ok = reachable(sim, ip);
  const head = isIp(target)
    ? `Pinging ${ip} with 32 bytes of data:`
    : `Pinging ${target} [${ip}] with 32 bytes of data:`;
  if (!ok) {
    return `${head}
Request timed out.
Request timed out.
Request timed out.
Request timed out.

Ping statistics for ${ip}:
    Packets: Sent = 4, Received = 4, Lost = 4 (100% loss),`;
  }
  const base = sim.latency && sim.latency[ip] ? sim.latency[ip] : ip === a.gw ? 1 : 17;
  const t = [base, base + 2, base - 1, base + 1];
  return `${head}
Reply from ${ip}: bytes=32 time=${t[0]}ms TTL=${ip === a.gw ? 128 : 114}
Reply from ${ip}: bytes=32 time=${t[1]}ms TTL=${ip === a.gw ? 128 : 114}
Reply from ${ip}: bytes=32 time=${t[2]}ms TTL=${ip === a.gw ? 128 : 114}
Reply from ${ip}: bytes=32 time=${t[3]}ms TTL=${ip === a.gw ? 128 : 114}

Ping statistics for ${ip}:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = ${Math.min(...t)}ms, Maximum = ${Math.max(...t)}ms, Average = ${base}ms`;
}

function cmdNslookup(sim, args) {
  const a = sim.adapter;
  const name = args[0] || "corp.local";
  const server = args[1] || (a.dns && a.dns[0]);
  const serverOk = server ? reachable(sim, server) && sim.dns !== "fail" : false;
  const altOk = args[1] ? reachable(sim, args[1]) : false;
  if (!server)
    return `*** Can't find server name for address: No DNS servers configured on this interface.`;
  if (args[1] && altOk) {
    const ip = (sim.resolve || {})[name.toLowerCase()] || "142.250.72.68";
    return `Server:  ${sim.dnsNames && sim.dnsNames[args[1]] ? sim.dnsNames[args[1]] : "dc01.corp.local"}
Address:  ${args[1]}

Non-authoritative answer:
Name:    ${name}
Address:  ${ip}`;
  }
  if (!serverOk) {
    return `Server:  UnKnown
Address:  ${server}

DNS request timed out.
    timeout was 2 seconds.
*** Request to UnKnown timed-out`;
  }
  const ip = (sim.resolve || {})[name.toLowerCase()];
  if (!ip)
    return `Server:  ${(sim.dnsNames || {})[server] || "dc01.corp.local"}
Address:  ${server}

*** ${(sim.dnsNames || {})[server] || "dc01.corp.local"} can't find ${name}: Non-existent domain`;
  return `Server:  ${(sim.dnsNames || {})[server] || "dc01.corp.local"}
Address:  ${server}

Non-authoritative answer:
Name:    ${name}
Address:  ${ip}`;
}

function cmdTracert(sim, target) {
  const a = sim.adapter;
  if (a.status === "disconnected" || a.apipa)
    return `Unable to resolve target system name ${target}.`;
  let ip = target;
  if (!isIp(target)) {
    const r = resolveName(sim, target);
    if (!r || sim.dns === "fail") return `Unable to resolve target system name ${target}.`;
    ip = r;
  }
  const hops = (sim.trace && sim.trace.hops) || [a.gw, "10.0.0.1", "203.0.113.9", ip];
  const failFrom = sim.trace && sim.trace.failFrom !== undefined ? sim.trace.failFrom : reachable(sim, ip) ? null : 1;
  let out = `Tracing route to ${isIp(target) ? ip : target + " [" + ip + "]"}\nover a maximum of 30 hops:\n`;
  hops.forEach((h, i) => {
    if (failFrom !== null && i >= failFrom) {
      out += `\n  ${String(i + 1).padStart(2)}     *        *        *     Request timed out.`;
    } else {
      const ms = i === 0 ? 1 : 4 + i * 5;
      out += `\n  ${String(i + 1).padStart(2)}    ${ms} ms    ${ms} ms    ${ms} ms  ${h}`;
    }
  });
  out += failFrom !== null ? `\n\nTrace incomplete.` : `\n\nTrace complete.`;
  return out;
}

function cmdNetstat(sim) {
  const a = sim.adapter;
  let out = `Active Connections

  Proto  Local Address          Foreign Address        State`;
  out += `
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING
  TCP    0.0.0.0:3389           0.0.0.0:0              LISTENING`;
  if (a.status !== "disconnected" && !a.apipa) {
    out += `
  TCP    ${a.ip}:49712      ${a.dns && a.dns[0] ? a.dns[0] : "10.20.5.10"}:389        ${
      sim.dns === "fail" ? "SYN_SENT" : "ESTABLISHED"
    }
  TCP    ${a.ip}:49788      52.96.104.18:443       ${sim.reach && sim.reach.default === false ? "SYN_SENT" : "ESTABLISHED"}
  TCP    ${a.ip}:49801      ${a.gw}:53           TIME_WAIT`;
  }
  out += `
  UDP    0.0.0.0:5353           *:*
  UDP    ${a.status === "disconnected" ? "0.0.0.0" : a.ip}:138        *:*`;
  return out;
}

const HELP = `Simulated console. Nothing runs on a real host.

  ipconfig [/all]        Adapter addressing and DNS assignment
  ping <host|ip>         ICMP reachability test
  nslookup <name> [srv]  Query a resolver directly
  tracert <host|ip>      Show the path, hop by hop
  netstat -an            Sockets and their state
  hostname               This machine's name
  whoami                 The signed-in account
  cls | clear            Clear the console
  help                   This list`;

function runCommand(sim, raw) {
  const line = raw.trim();
  if (!line) return "";
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  const extra = sim.extra || [];
  for (const [pattern, output] of extra) {
    if (line.toLowerCase().startsWith(pattern.toLowerCase())) return output;
  }
  switch (cmd) {
    case "help":
    case "?":
      return HELP;
    case "hostname":
      return sim.hostname;
    case "whoami":
      return sim.user.toLowerCase();
    case "ipconfig": {
      const all = args.some((a) => a.toLowerCase() === "/all");
      if (args.some((a) => a.toLowerCase() === "/flushdns"))
        return "Windows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.";
      if (args.some((a) => a.toLowerCase() === "/release"))
        return `Windows IP Configuration\n\n${sim.releaseText || "No operation can be performed on Ethernet while it has its media disconnected."}`;
      if (args.some((a) => a.toLowerCase() === "/renew"))
        return `Windows IP Configuration\n\n${
          sim.renewText ||
          "An error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out."
        }`;
      let head = "Windows IP Configuration\n\n";
      if (all)
        head += `   Host Name . . . . . . . . . . . . : ${sim.hostname}
   Primary Dns Suffix  . . . . . . . : corp.local
   Node Type . . . . . . . . . . . . : Hybrid
   IP Routing Enabled. . . . . . . . : No

`;
      return head + [sim.adapter, ...(sim.adapters || [])].map((a) => adapterBlock(a, all)).join("\n\n");
    }
    case "ping":
      if (!args.length) return "Usage: ping <hostname or ip>";
      return cmdPing(sim, args.filter((a) => !a.startsWith("-"))[0]);
    case "nslookup":
      return cmdNslookup(sim, args);
    case "tracert":
    case "traceroute":
      if (!args.length) return "Usage: tracert <hostname or ip>";
      return cmdTracert(sim, args[0]);
    case "netstat":
      return cmdNetstat(sim);
    case "cls":
    case "clear":
      return "__CLEAR__";
    case "dir":
    case "ls":
      return "This lab does not simulate a file system. Try `help`.";
    default:
      return `'${parts[0]}' is not recognized as an internal or external command,
operable program or batch file.

This console only answers the commands listed under \`help\`.`;
  }
}

/* ------------------------------------------------------- scenario catalogue */
const SCENARIOS = [
/* ------------------------------------------------------------------ 01 */
{
  id: "no-internet",
  title: "No internet on a wired desk",
  category: "Network",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104721",
    user: "Dana Whitfield",
    dept: "Accounts Payable",
    device: "Dell OptiPlex 7090 — WKS-4471",
    priority: "High",
    opened: "08:42",
    issue: "No network connectivity from wired workstation",
  },
  complaint:
    "I got in this morning and nothing loads. Teams says disconnected, no websites at all. There's a little red X on the network icon. I have invoices that have to go out before the close today.",
  sim: {
    hostname: "WKS-4471",
    user: "CORP\\dwhitfield",
    dns: "fail",
    adapter: {
      type: "Ethernet",
      name: "Ethernet",
      desc: "Intel(R) Ethernet Connection (11) I219-LM",
      mac: "B0-7B-25-1C-4E-A9",
      status: "disconnected",
      dhcp: true,
      ip: "",
      mask: "",
      gw: "",
      dns: [],
    },
    reach: { default: false },
  },
  stages: [
    "Establish the interface state",
    "Inspect the physical path",
    "Prove it with a known-good port",
    "Confirm addressing returns",
  ],
  actions: [
    {
      id: "a1", label: "Run ipconfig /all", cat: "Console", stage: 0, cmd: "ipconfig /all",
      ev: "Ethernet adapter reports Media disconnected — no IPv4 address bound.",
      fb: "Right first move. Before anything above Layer 1 matters, you need to know whether the interface even has a carrier.",
    },
    {
      id: "a2", label: "Inspect NIC link light and cable run", cat: "Hardware", stage: 1,
      out: `[ On-site inspection — WKS-4471, desk B-14 ]

NIC link LED ........... dark (no link, no activity)
Patch cable at PC ...... seated, latch intact
Cable route ............ runs under desk to wall plate B-14
Wall plate ............. faceplate loose, jack sits back in the box
Neighbour desk B-15 .... link LED green, user online`,
      ev: "No link LED. Faceplate at jack B-14 is loose; neighbouring desk on the same switch is fine.",
      fb: "Exactly. 'Media disconnected' is a copper problem until proven otherwise, and the neighbouring desk rules out the switch and the VLAN.",
    },
    {
      id: "a3", label: "Retest with a known-good cable and port", cat: "Hardware", stage: 2,
      out: `[ Substitution test ]

Swapped patch cable (known good) into jack B-14 ...... still no link
Moved patch cable to jack B-15 (spare port) ......... link LED green, 1 Gbps

Conclusion: the failure follows the wall jack, not the cable or the PC.`,
      ev: "Fault follows jack B-14. Same PC and cable link up fine on jack B-15.",
      fb: "This is the step that turns a guess into a diagnosis. You changed one variable at a time and the fault stayed with the jack.",
    },
    {
      id: "a4", label: "Re-run ipconfig to confirm a lease", cat: "Console", stage: 3, cmd: "ipconfig",
      simOverride: {
        adapter: {
          type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection (11) I219-LM",
          mac: "B0-7B-25-1C-4E-A9", status: "connected", dhcp: true,
          ip: "10.20.5.61", mask: "255.255.255.0", gw: "10.20.5.1", dns: ["10.20.5.10", "10.20.5.11"],
          dhcpServer: "10.20.5.10", suffix: "corp.local",
        },
        dns: "ok",
        reach: { default: true },
      },
      ev: "DHCP lease obtained: 10.20.5.61/24 via gateway 10.20.5.1. Connectivity restored.",
      fb: "Closing the loop. A fix isn't a fix until the original symptom is gone and you have watched it be gone.",
    },
    {
      id: "b1", label: "Flush the DNS resolver cache", cat: "Console", stage: null, cmd: "ipconfig /flushdns",
      fb: "Nothing to flush toward. With no carrier on the wire there is no path to a resolver — this is a Layer 1 fault and DNS sits five layers up.",
    },
    {
      id: "b2", label: "Reset the TCP/IP stack (netsh int ip reset)", cat: "Console", stage: null,
      out: `Resetting Global, OK!
Resetting Interface, OK!
Restart the computer to complete this action.

[ No change: adapter still reports Media disconnected ]`,
      fb: "A heavy, reboot-requiring change aimed at a layer that isn't broken. Reserve stack resets for cases where the interface has link but the IP stack misbehaves.",
    },
    {
      id: "b3", label: "Reboot the workstation", cat: "System", stage: null,
      out: `[ Restart complete — 2m 14s of user downtime ]

Adapter state after restart: Media disconnected`,
      fb: "The reflex fix. It costs the user two minutes and tells you nothing a reboot can't change — a dead copper link survives every restart.",
    },
    {
      id: "b4", label: "Escalate to the network team", cat: "Escalation", stage: null,
      out: `[ Ticket routed to NET-OPS queue ]

NET-OPS response (11 min): "Switch SW-2F-A port Gi1/0/14 is up/up with no
frames received. Nothing wrong on our side — please verify the desk-side
cabling before routing to us."`,
      fb: "Escalating before you've done the desk-side checks sends the ticket on a round trip and comes straight back. Own Layer 1 first.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Layer 1 failure — the wall jack B-14 has no link, so the NIC never comes up", correct: true },
    { id: "d2", text: "DHCP scope exhaustion on the workstation VLAN" },
    { id: "d3", text: "DNS servers unreachable, blocking all name resolution" },
    { id: "d4", text: "Corrupt TCP/IP stack on the workstation" },
    { id: "d5", text: "ISP outage affecting the whole site" },
  ],
  fixes: [
    { id: "f1", text: "Move the user to the spare port, raise a facilities job to re-terminate jack B-14, confirm the DHCP lease", correct: true },
    { id: "f2", text: "Assign a static IP address on the workstation" },
    { id: "f3", text: "Reinstall the network adapter driver" },
    { id: "f4", text: "Ask the user to work from Wi-Fi permanently" },
  ],
  concept: {
    term: "Media disconnected",
    body: "Windows prints 'Media disconnected' when the NIC detects no carrier on the wire — no link partner, no negotiated speed, nothing. At that point the adapter has no IPv4 address, no gateway and no resolver, so every symptom above it (no websites, no Teams, no mapped drives) is a downstream effect of one physical fact. Work the OSI model from the bottom up: if Layer 1 is dead, no amount of DNS, proxy or browser work can help.",
  },
  report: {
    diagnosis: "Loss of physical link on the wired interface at desk B-14.",
    root: "The RJ45 keystone in wall plate B-14 has pulled back into the box and lost its punch-down contact. The workstation NIC never negotiated a link, so DHCP never ran and no IPv4 address was assigned.",
    fix: "Patched the workstation into spare jack B-15 on the same switch and VLAN, confirmed a 1 Gbps link and a valid DHCP lease (10.20.5.61/24), then raised a facilities job to re-terminate and re-secure jack B-14.",
    prevent: "Add loose faceplates and dead jacks to the floor-walk checklist, and label jacks that fail so they can be re-terminated in one visit rather than one ticket at a time.",
  },
},
/* ------------------------------------------------------------------ 02 */
{
  id: "dns-failure",
  title: "Connected, but no site will load",
  category: "Network",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104733",
    user: "Marcus Bell",
    dept: "Marketing",
    device: "Dell Latitude 5540 — LT-2291",
    priority: "Medium",
    opened: "09:15",
    issue: "Wi-Fi shows connected but no websites resolve",
  },
  complaint:
    "My computer says it is connected to Wi-Fi, full bars, but I can't access any websites. The weird part is the shared drive still works and I can print.",
  sim: {
    hostname: "LT-2291",
    user: "CORP\\mbell",
    dns: "fail",
    adapter: {
      type: "Wireless LAN", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 6E AX211 160MHz",
      mac: "3C-58-C2-77-01-B4", status: "connected", dhcp: true, dnsStatic: true,
      ip: "10.20.9.87", mask: "255.255.255.0", gw: "10.20.9.1",
      dns: ["10.20.5.99"], dhcpServer: "10.20.5.10", suffix: "corp.local",
      lease: "Saturday, August 15, 2026 07:58:12",
      expires: "Sunday, August 16, 2026 07:58:12",
    },
    reach: { gateway: true, "8.8.8.8": true, "10.20.5.99": false, "10.20.5.10": true, default: true },
    latency: { "10.20.9.1": 2, "8.8.8.8": 16 },
    resolve: { "www.google.com": "142.250.72.68", "corp.local": "10.20.5.10", "fs01.corp.local": "10.20.5.40" },
    dnsNames: { "10.20.5.10": "dc01.corp.local", "10.20.5.11": "dc02.corp.local" },
    trace: { hops: ["10.20.9.1", "10.0.0.1", "203.0.113.9", "142.250.72.68"], failFrom: null },
  },
  stages: [
    "Read the addressing",
    "Test the local segment",
    "Test routing to the internet",
    "Test name resolution",
    "Prove which resolver is at fault",
  ],
  actions: [
    {
      id: "a1", label: "Run ipconfig /all", cat: "Console", stage: 0, cmd: "ipconfig /all",
      ev: "IP 10.20.9.87/24 from DHCP, gateway 10.20.9.1 — but DNS is a single server, 10.20.5.99.",
      fb: "Good. The addressing looks healthy, and one detail is already odd: DHCP is enabled yet the resolver list is a single unfamiliar address.",
    },
    {
      id: "a2", label: "Ping the default gateway", cat: "Console", stage: 1, cmd: "ping 10.20.9.1",
      ev: "Gateway 10.20.9.1 replies in ~2 ms — the local segment is healthy.",
      fb: "Correct order. Prove the local segment before you accuse anything upstream.",
    },
    {
      id: "a3", label: "Ping a public IP address", cat: "Console", stage: 2, cmd: "ping 8.8.8.8",
      ev: "8.8.8.8 replies in ~16 ms — routing and internet egress are working.",
      fb: "This is the pivot of the whole scenario: packets reach the internet by IP, so the transport path is intact.",
    },
    {
      id: "a4", label: "Ping a website by name", cat: "Console", stage: 3, cmd: "ping www.google.com",
      ev: "Ping by name fails: host not found. IP works, name does not — classic resolution failure.",
      fb: "The textbook comparison. Same destination, one attempt by address and one by name — only the name fails, so the fault is resolution.",
    },
    {
      id: "a5", label: "Query a known-good resolver directly", cat: "Console", stage: 4, cmd: "nslookup www.google.com 10.20.5.10",
      ev: "dc01 (10.20.5.10) resolves www.google.com instantly. Only the configured resolver 10.20.5.99 fails.",
      fb: "This is what turns 'DNS is broken' into 'this client's resolver is wrong'. The service is fine; the pointer on this adapter is not.",
    },
    {
      id: "b1", label: "Query the configured resolver", cat: "Console", stage: null, cmd: "nslookup www.google.com",
      ev: "Configured resolver 10.20.5.99 times out.",
      fb: "Useful supporting evidence rather than a wrong turn — it confirms the configured server is dead, but on its own it can't tell you whether DNS as a service is down or just this client's setting.",
    },
    {
      id: "b2", label: "Flush the DNS resolver cache", cat: "Console", stage: null, cmd: "ipconfig /flushdns",
      fb: "A reasonable instinct that solves a different problem. Flushing helps when the cache holds a stale record; it cannot help when the resolver itself never answers.",
    },
    {
      id: "b3", label: "Reset the browser and clear its cache", cat: "Apps", stage: null,
      out: `[ Chrome reset to defaults, cache and cookies cleared ]

Test: http://www.google.com  ->  DNS_PROBE_FINISHED_NXDOMAIN
Test: http://142.250.72.68   ->  page loads`,
      fb: "The browser was never the problem, and the test you just ran proves it: raw IP loads, name doesn't. That's beneath the application.",
    },
    {
      id: "b4", label: "Reboot the wireless access point", cat: "Escalation", stage: null,
      out: `[ Request declined by NET-OPS ]

"AP-2F-04 has 26 associated clients, all passing traffic. We are not
bouncing it for a single host that already has a working default route."`,
      fb: "Twenty-five other people on the same AP are fine, and this laptop is routing to 8.8.8.8. Shared infrastructure is the last suspect when the fault is one machine.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "The adapter has a statically configured DNS server (10.20.5.99) that no longer exists", correct: true },
    { id: "d2", text: "The site's internet circuit is down" },
    { id: "d3", text: "The wireless access point is dropping traffic" },
    { id: "d4", text: "The browser cache is corrupt" },
    { id: "d5", text: "The DHCP server is handing out a bad scope" },
  ],
  fixes: [
    { id: "f1", text: "Set the adapter back to obtain DNS automatically, flush the cache, and confirm resolution against dc01/dc02", correct: true },
    { id: "f2", text: "Hard-code 8.8.8.8 as the DNS server on the laptop" },
    { id: "f3", text: "Rebuild the wireless profile" },
    { id: "f4", text: "Reimage the laptop" },
  ],
  concept: {
    term: "Ping by IP works, ping by name fails",
    body: "That single comparison isolates name resolution from everything else. Reaching 8.8.8.8 proves the adapter, the gateway, routing and the firewall path all work; failing on www.google.com proves only the translation step is broken. From there, nslookup against a known-good server separates a dead resolver from a misconfigured client. Static DNS entries are a common leftover — they survive DHCP renewals, reboots and reimaging of the DHCP scope itself, so a decommissioned server can haunt a client for months.",
  },
  report: {
    diagnosis: "Name resolution failure on a single client caused by a stale static DNS entry.",
    root: "The IPv4 properties of the Wi-Fi adapter had DNS manually set to 10.20.5.99 — a domain controller retired during the DC consolidation. DHCP continued to supply address, mask and gateway, so everything except name resolution kept working; SMB access to fs01 survived because the mapping used a cached entry and a NetBIOS lookup on the local subnet.",
    fix: "Set the adapter's IPv4 DNS back to 'Obtain DNS server address automatically', ran ipconfig /release and /renew, flushed the resolver cache, and verified forward and reverse lookups against dc01 and dc02.",
    prevent: "Run a fleet-wide report for adapters with manually configured DNS before retiring any domain controller, and push resolver settings by DHCP option rather than by hand during builds.",
  },
},
/* ------------------------------------------------------------------ 03 */
{
  id: "dhcp-failure",
  title: "A row of desks loses the network at once",
  category: "Network",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104750",
    user: "Priya Raman",
    dept: "Operations",
    device: "HP EliteDesk 800 — WKS-3312",
    priority: "High",
    opened: "09:40",
    issue: "Multiple workstations on VLAN 7 have no network access",
  },
  complaint:
    "Three of us on this row lost the network at about the same time. The cables are all plugged in and the lights on the sockets are on, but nothing works. The people on the other side of the aisle are fine.",
  sim: {
    hostname: "WKS-3312",
    user: "CORP\\praman",
    dns: "fail",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Realtek PCIe GbE Family Controller",
      mac: "44-1E-A1-33-90-2C", status: "connected", dhcp: true, apipa: true,
      ip: "169.254.88.13", mask: "255.255.0.0", gw: "", dns: [], dhcpServer: "N/A", suffix: "",
    },
    reach: { default: false },
    releaseText: "IPv4 Address for Ethernet has been released.",
    renewText:
      "An error occurred while renewing interface Ethernet : unable to contact your DHCP server. Request has timed out.",
    extra: [
      ["arp -a", `Interface: 169.254.88.13 --- 0x8
  Internet Address      Physical Address      Type
  169.254.255.255       ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static

[ No ARP entries for the 10.20.7.0/24 subnet — the host has no valid address on it. ]`],
    ],
  },
  stages: [
    "Read the address the client gave itself",
    "Attempt a fresh lease",
    "Confirm the physical path is fine",
    "Check the DHCP scope at the server",
  ],
  actions: [
    {
      id: "a1", label: "Run ipconfig", cat: "Console", stage: 0, cmd: "ipconfig",
      ev: "Address is 169.254.88.13 / 255.255.0.0 with no gateway — APIPA, so no DHCP offer was received.",
      fb: "The single most informative line in the scenario. A 169.254 address is the client announcing that it asked for a lease and nobody answered.",
    },
    {
      id: "a2", label: "Release and renew the lease", cat: "Console", stage: 1, cmd: "ipconfig /renew",
      ev: "Renew fails: unable to contact the DHCP server, request timed out.",
      fb: "Correct — you've confirmed the failure is live and repeatable rather than a leftover from a boot-time race.",
    },
    {
      id: "a3", label: "Verify link and switch port state", cat: "Hardware", stage: 2,
      out: `[ Desk-side + switch check — SW-2F-B ]

WKS-3312 NIC link ......... green, 1 Gbps full duplex
Port Gi1/0/22 ............. up/up, VLAN 7, counters incrementing
Neighbouring desks ........ WKS-3313, WKS-3314 also on 169.254.x.x
Aisle opposite ............ VLAN 9, all clients addressed normally

Pattern: every affected host is on VLAN 7.`,
      ev: "Link and switch ports are healthy. All affected hosts are on VLAN 7; VLAN 9 clients are unaffected.",
      fb: "This is the step that scopes the incident. Healthy Layer 1 plus a clean VLAN boundary means you are looking at an address-assignment problem, not a cabling one.",
    },
    {
      id: "a4", label: "Review the DHCP scope on the server", cat: "Server", stage: 3,
      out: `[ DHCP console — DC01, IPv4 scopes ]

Scope            Range                Leases  Available  Utilisation
10.20.7.0/24     10.20.7.20-.250      231     0          100%
10.20.9.0/24     10.20.9.20-.250      118     113        51%

Scope 10.20.7.0 lease duration ......... 8 days
Active leases from non-domain devices .. 96 (contractor tablets, phones)
Event 1063 logged 07:51: "The DHCP service failed to issue an address.
The scope is full."`,
      ev: "Scope 10.20.7.0/24 is 100% utilised — 0 addresses available. 96 leases belong to transient non-domain devices on an 8-day lease.",
      fb: "There it is. The relay and the service are both alive; the pool simply has nothing left to hand out.",
    },
    {
      id: "b1", label: "Assign a static IP to the workstation", cat: "System", stage: null,
      out: `[ Static address 10.20.7.240/24 applied to WKS-3312 ]

Connectivity restored for this host.

Warning: 10.20.7.240 sits inside the DHCP range. If the scope is ever
repaired, this address can be leased to another device and cause a
duplicate-address outage on both machines.`,
      fb: "It gets one user working and it will bite you later. A static inside the DHCP range is a future duplicate-address ticket, and it hides the incident from the two colleagues who are still down.",
    },
    {
      id: "b2", label: "Reinstall the network adapter driver", cat: "System", stage: null,
      out: `[ Driver reinstalled — Realtek PCIe GbE, v10.68.0225 ]

Adapter re-enumerated. Address after restart: 169.254.88.13`,
      fb: "Three machines failed simultaneously with identical symptoms. A driver fault on three different models at the same minute isn't a plausible explanation.",
    },
    {
      id: "b3", label: "Flush DNS and reset Winsock", cat: "Console", stage: null,
      out: `Successfully flushed the DNS Resolver Cache.
Winsock reset completed successfully.

[ Address unchanged: 169.254.88.13 ]`,
      fb: "Cleanup commands aimed above the problem. The host has no routable address at all, so there is nothing for a resolver or a socket catalogue to do.",
    },
    {
      id: "b4", label: "Replace the patch cable", cat: "Hardware", stage: null,
      out: `[ Cable swapped for a known-good lead ]

Link renegotiated at 1 Gbps. Address after renew: 169.254.88.13`,
      fb: "The link light was already on and the switch port already showed up/up — swapping copper was never going to change an addressing failure.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "DHCP scope exhaustion on VLAN 7 — the pool has no addresses left to lease", correct: true },
    { id: "d2", text: "The DHCP service on DC01 has stopped" },
    { id: "d3", text: "The switch ports for that row have been shut down" },
    { id: "d4", text: "A rogue DHCP server is answering first" },
    { id: "d5", text: "The workstations have corrupt network drivers" },
  ],
  fixes: [
    { id: "f1", text: "Cut the VLAN 7 lease duration to 8 hours, reclaim stale leases, extend the scope range, then renew the affected clients", correct: true },
    { id: "f2", text: "Statically address every affected workstation" },
    { id: "f3", text: "Restart the DHCP service on DC01" },
    { id: "f4", text: "Move the affected desks onto VLAN 9" },
  ],
  concept: {
    term: "APIPA — 169.254.x.x",
    body: "Automatic Private IP Addressing is what a Windows client does when it broadcasts a DHCPDISCOVER and receives no offer. It picks an address from 169.254.0.0/16 with a 255.255.0.0 mask, sets no default gateway and no DNS servers. So 169.254 is never the cause of an outage — it is the client telling you the cause. Three questions follow: is the client's broadcast leaving the port, is the relay forwarding it to the server, and does the server still have an address to give? A long lease duration combined with transient devices is the usual way a scope quietly runs dry.",
  },
  report: {
    diagnosis: "DHCP address-assignment failure across VLAN 7 caused by scope exhaustion.",
    root: "Scope 10.20.7.0/24 reached 100% utilisation. An 8-day lease duration meant contractor tablets and personal phones that had briefly joined the wired dock stations still held addresses days after leaving, consuming 96 of the 231 leases. Once the pool emptied, any client renewing or booting received no offer and fell back to APIPA.",
    fix: "Reduced the VLAN 7 lease duration to 8 hours, deleted stale leases with no matching DNS record, extended the scope range to 10.20.7.16-.254, then ran ipconfig /renew on the three affected workstations and confirmed valid addressing and gateway reachability.",
    prevent: "Alert on scope utilisation above 80% rather than waiting for exhaustion, keep lease durations proportional to how long devices actually stay, and put transient and guest devices on a separate scope so they can never starve corporate clients.",
  },
},
/* ------------------------------------------------------------------ 04 */
{
  id: "printer-not-printing",
  title: "Print jobs vanish into the queue",
  category: "Peripherals",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104762",
    user: "Helen Ortiz",
    dept: "Human Resources",
    device: "Dell Latitude 5440 — LT-1188 / HP LaserJet M507 (PRN-HR-02)",
    priority: "Medium",
    opened: "10:05",
    issue: "Documents sent to the HR printer never print",
  },
  complaint:
    "I've sent the same offer letter six times and nothing comes out. The printer screen says Ready and there's paper in it. Nothing on my screen tells me anything is wrong.",
  sim: {
    hostname: "LT-1188",
    user: "CORP\\hortiz",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection I219-V",
      mac: "9C-2A-70-5D-11-08", status: "connected", dhcp: true,
      ip: "10.20.11.62", mask: "255.255.255.0", gw: "10.20.11.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "prn-hr-02.corp.local": "10.20.11.90", "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["sc query spooler", `SERVICE_NAME: spooler
        TYPE               : 110  WIN32_OWN_PROCESS
        STATE              : 1  STOPPED
        WIN32_EXIT_CODE    : 1067  (0x42b)
        SERVICE_EXIT_CODE  : 0  (0x0)`],
    ],
  },
  stages: [
    "Look at the queue",
    "Check the service behind the queue",
    "Clear the stuck job and restart the service",
    "Verify with a test page",
  ],
  actions: [
    {
      id: "a1", label: "Open the print queue on the workstation", cat: "Apps", stage: 0,
      out: `[ PRN-HR-02 on LT-1188 — queue ]

Document                     Status              Owner    Size
Offer_Letter_Kaur.docx       Error - Printing    hortiz   184 KB
Offer_Letter_Kaur.docx       Spooling            hortiz   184 KB
Offer_Letter_Kaur.docx       Spooling            hortiz   184 KB
Offer_Letter_Kaur.docx       Spooling            hortiz   184 KB
Offer_Letter_Kaur.docx       Spooling            hortiz   184 KB
Offer_Letter_Kaur.docx       Spooling            hortiz   184 KB

Queue does not respond to Cancel. Status bar: "Print Spooler not running".`,
      ev: "Six jobs queued; the head job is stuck in 'Error - Printing' and the queue reports the spooler is not running.",
      fb: "Start where the evidence is densest. The queue tells you the jobs were accepted locally and then stopped — which points at the client, not the printer.",
    },
    {
      id: "a2", label: "Check the Print Spooler service", cat: "System", stage: 1, cmd: "sc query spooler",
      ev: "Print Spooler service is STOPPED with exit code 1067 (process terminated unexpectedly).",
      fb: "Confirmed. Exit code 1067 means the service died rather than being stopped deliberately — usually because it choked on something in the queue.",
    },
    {
      id: "a3", label: "Stop the spooler, clear the spool folder, start it again", cat: "System", stage: 2,
      out: `net stop spooler
The Print Spooler service is not started.

del /Q C:\\Windows\\System32\\spool\\PRINTERS\\*
  FP00061.SHD   deleted
  FP00061.SPL   deleted   (184 KB, malformed header)
  FP00062.SHD   deleted
  FP00062.SPL   deleted
  ... 12 files removed

net start spooler
The Print Spooler service was started successfully.`,
      ev: "Removed 12 orphaned spool files including a malformed .SPL. Spooler restarted and is running.",
      fb: "The right sequence, and the order matters: the folder can only be cleared while the service is stopped, or the files are locked and come straight back.",
    },
    {
      id: "a4", label: "Print a test page and confirm output", cat: "Apps", stage: 3,
      out: `[ Test page sent to PRN-HR-02 ]

Job 1 ...... Printed (00:04)
Queue ...... empty

User reprinted Offer_Letter_Kaur.docx — one copy delivered.
Service recovery set: restart on first, second and subsequent failures.`,
      ev: "Test page and the user's document both print. Service recovery configured to auto-restart the spooler.",
      fb: "Verified with the user's own document, not just a test page — that's what closes a ticket without a callback.",
    },
    {
      id: "b1", label: "Ping the printer", cat: "Console", stage: null, cmd: "ping prn-hr-02.corp.local",
      ev: "Printer responds on the network.",
      fb: "Fair check and cheap to run, but the queue already showed jobs being accepted and failing locally — network reachability was never in question.",
    },
    {
      id: "b2", label: "Reinstall the printer driver", cat: "System", stage: null,
      out: `[ Driver removed and reinstalled — HP Universal Print Driver PCL6 v7.1 ]

Reinstall completes. Queued jobs remain; new jobs still do not print.`,
      fb: "A twenty-minute fix for a two-minute fault, and it can't work while the spooler that hosts the driver is stopped. Reinstall drivers when you have evidence of a driver fault.",
    },
    {
      id: "b3", label: "Replace the toner cartridge", cat: "Hardware", stage: null,
      out: `[ Toner replaced — previous cartridge at 61% ]

No change. Printer panel still reports Ready with no jobs received.`,
      fb: "The printer said Ready and reported no received jobs, so consumables were never in play. This one also costs real money.",
    },
    {
      id: "b4", label: "Restart the workstation", cat: "System", stage: null,
      out: `[ Restart complete ]

Print Spooler starts, chokes on FP00061.SPL, and stops again after 6s.
Queue: 6 jobs, head job "Error - Printing".`,
      fb: "It gets close and still fails, which is instructive: the spooler restarts, hits the same malformed job and dies again. The corrupt file has to be removed.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "The Print Spooler service crashed on a malformed job and left the queue stuck", correct: true },
    { id: "d2", text: "The printer is offline or unreachable on the network" },
    { id: "d3", text: "The print driver is the wrong architecture" },
    { id: "d4", text: "The user lacks permission to print to PRN-HR-02" },
    { id: "d5", text: "The printer is out of toner" },
  ],
  fixes: [
    { id: "f1", text: "Stop the spooler, clear C:\\Windows\\System32\\spool\\PRINTERS, restart it, and set service recovery to auto-restart", correct: true },
    { id: "f2", text: "Reinstall the printer and its driver from scratch" },
    { id: "f3", text: "Map the printer by IP address instead of by name" },
    { id: "f4", text: "Move the user to a different printer" },
  ],
  concept: {
    term: "The spooler and the PRINTERS folder",
    body: "Every job you print is written to disk before it reaches the printer: a .SPL file holding the render data and a .SHD file holding the job settings, both in C:\\Windows\\System32\\spool\\PRINTERS. The Print Spooler service reads those files back and feeds them to the port monitor. If one job is malformed the service can crash on it, and because the file survives the crash it crashes again on every restart — which is why rebooting appears to work for a few seconds and then fails identically. Clearing the folder is only possible with the service stopped, since running spooler holds the files open.",
  },
  report: {
    diagnosis: "Print Spooler service failure on the client, caused by a corrupt spooled job.",
    root: "A malformed .SPL file (FP00061.SPL) generated during an interrupted print of Offer_Letter_Kaur.docx caused the Print Spooler to terminate with exit code 1067. Because the file remained on disk, the service crashed again on every restart, and every subsequent print attempt queued behind a job that could never complete.",
    fix: "Stopped the Print Spooler, deleted the contents of C:\\Windows\\System32\\spool\\PRINTERS, restarted the service, and confirmed output with a test page and a reprint of the user's document. Configured service recovery to restart the spooler automatically on failure.",
    prevent: "Deploy spooler recovery settings by policy across the fleet, and monitor for Event ID 7031 on the Print Spooler so repeat crashes are caught before users notice.",
  },
},
/* ------------------------------------------------------------------ 05 */
{
  id: "slow-computer",
  title: "Everything takes minutes to open",
  category: "Performance",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104779",
    user: "Greg Tanaka",
    dept: "Finance",
    device: "Lenovo ThinkPad T14 — LT-1904",
    priority: "Medium",
    opened: "10:22",
    issue: "Severe performance degradation, applications slow to launch",
  },
  complaint:
    "It takes about eight minutes to open Excel. The mouse still moves, everything just sits there spinning. It started maybe two weeks ago and it's getting worse. Someone told me I need more memory.",
  sim: {
    hostname: "LT-1904",
    user: "CORP\\gtanaka",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection I219-LM",
      mac: "54-BF-64-19-2D-77", status: "connected", dhcp: true,
      ip: "10.20.5.118", mask: "255.255.255.0", gw: "10.20.5.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "backup-old.corp.local": null, "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["wmic diskdrive get status", `Status
OK`],
      ["sc query vaultagent", `SERVICE_NAME: VaultAgent
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
        SERVICE_EXIT_CODE  : 0  (0x0)`],
    ],
  },
  stages: [
    "Find which resource is saturated",
    "Identify the process responsible",
    "Explain why that process is misbehaving",
    "Stop it and measure the result",
  ],
  actions: [
    {
      id: "a1", label: "Open Task Manager and read resource utilisation", cat: "System", stage: 0,
      out: `[ Task Manager — Performance ]

CPU ......... 11%   (i7-1355U)
Memory ...... 61%   (9.8 / 16.0 GB)
Disk 0 ...... 100%  active time, avg response 4,180 ms
Network ..... 2%

Disk 0: TOSHIBA MQ01ACF032 — 5400 rpm SATA HDD`,
      ev: "Disk 0 pinned at 100% active time with 4,180 ms average response. CPU 11%, memory 61% — neither is the bottleneck.",
      fb: "This is the whole discipline in one step: measure before you buy. The disk is saturated and memory has headroom, which already rules out the user's theory.",
    },
    {
      id: "a2", label: "Sort processes by disk I/O", cat: "System", stage: 1,
      out: `[ Task Manager — Processes, sorted by Disk ]

Process                        CPU     Memory    Disk
VaultAgent.exe                 4.1%    212 MB    39.6 MB/s
System                         0.8%      -        1.1 MB/s
OneDrive.exe                   0.3%    148 MB     0.4 MB/s
EXCEL.EXE                      0.1%    301 MB     0.2 MB/s
MsMpEng.exe                    1.9%    286 MB     0.1 MB/s

VaultAgent.exe has read 1.7 TB since boot (uptime 6 days).`,
      ev: "VaultAgent.exe is reading ~40 MB/s continuously — 1.7 TB read across a 6-day uptime.",
      fb: "You've gone from 'the disk is busy' to 'this process is making it busy'. That single name is what the rest of the investigation hangs on.",
    },
    {
      id: "a3", label: "Read the VaultAgent application log", cat: "System", stage: 2,
      out: `[ Event Viewer — Applications and Services > VaultAgent ]

10:19:44  WARN  Cannot contact backup server backup-old.corp.local
10:19:44  INFO  Catalogue considered invalid — starting full volume scan
10:22:07  WARN  Cannot contact backup server backup-old.corp.local
10:22:07  INFO  Catalogue considered invalid — starting full volume scan
...pattern repeats every ~150 seconds since 02 Aug

Software inventory: VaultAgent 6.2 — product retired 01 Aug 2026,
replaced by the Intune backup policy. Uninstall was not pushed to
devices that were offline during the removal window.`,
      ev: "VaultAgent can't reach the retired server backup-old, so it restarts a full volume scan every ~150 seconds. The product was decommissioned on 01 Aug.",
      fb: "This converts a symptom into a root cause. The agent isn't faulty — it is doing exactly what it was written to do, against a server that no longer exists.",
    },
    {
      id: "a4", label: "Stop and disable the service, then re-measure", cat: "System", stage: 3,
      out: `net stop VaultAgent
The VaultAgent service was stopped successfully.

sc config VaultAgent start= disabled
[SC] ChangeServiceConfig SUCCESS

[ Task Manager after 5 minutes ]
Disk 0 ...... 3%   avg response 6 ms
Excel cold launch: 4.1 seconds (was 7m 52s)`,
      ev: "With VaultAgent stopped, disk drops to 3% and Excel launches in 4 seconds.",
      fb: "Measured, not assumed. You have a before and an after on the same counter, which is what makes this defensible in the ticket notes.",
    },
    {
      id: "b1", label: "Order a RAM upgrade to 32 GB", cat: "Hardware", stage: null,
      out: `[ Procurement quote raised — 16 GB SODIMM, £74 ]

Note from earlier measurement: memory utilisation 61%, no page-file
pressure, zero hard faults per second.`,
      fb: "This is the request the user made, and the counters say no. Memory has headroom and there's no paging pressure — the money buys nothing.",
    },
    {
      id: "b2", label: "Run Disk Defragmenter", cat: "System", stage: null,
      out: `[ Optimize Drives — C: ]

Analysis: 6% fragmented.
Optimisation queued behind existing I/O; estimated 4h 20m.
Disk response time during run: 9,600 ms. User reports machine unusable.`,
      fb: "You've added heavy sequential I/O to a disk that is already the bottleneck. During the run the machine is worse, not better.",
    },
    {
      id: "b3", label: "Run a full antivirus scan", cat: "System", stage: null,
      out: `[ Microsoft Defender — full scan ]

Items scanned: 812,004    Threats found: 0    Elapsed: 2h 51m
Disk 0 active time during scan: 100%`,
      fb: "Nearly three hours of extra disk load to confirm what the process list already suggested. A full scan is a reasonable step when a process is unrecognised — this one was signed and inventoried.",
    },
    {
      id: "b4", label: "Reimage the laptop", cat: "System", stage: null,
      out: `[ Reimage scheduled — 3h build + user data restore ]

Post-build software deployment includes VaultAgent 6.2 from the
legacy application group, which is still assigned to this device.`,
      fb: "The nuclear option that reinstalls the fault. Worth remembering: reimaging only helps if you know the problem isn't in the image or the assigned software.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "An orphaned backup agent is saturating the disk by rescanning the volume in a loop", correct: true },
    { id: "d2", text: "The laptop has insufficient RAM for its workload" },
    { id: "d3", text: "The hard disk is failing" },
    { id: "d4", text: "Malware is running in the background" },
    { id: "d5", text: "The Windows profile is corrupt" },
  ],
  fixes: [
    { id: "f1", text: "Uninstall VaultAgent, remove the legacy app assignment, and query the fleet for other devices still running it", correct: true },
    { id: "f2", text: "Add 16 GB of RAM" },
    { id: "f3", text: "Schedule a nightly defrag" },
    { id: "f4", text: "Disable Windows Search indexing" },
  ],
  concept: {
    term: "Find the saturated resource first",
    body: "'Slow' is a symptom with four possible owners: CPU, memory, disk or network. Task Manager names the owner in about ten seconds, and the answer decides everything that follows. Disk at 100% active time with response times in seconds is a queueing problem — requests are arriving faster than the drive can service them, so every application that touches disk appears to hang while CPU sits nearly idle. Memory pressure looks different: high commit, sustained hard faults per second, and the page file growing. Buying hardware before reading the counters is how you end up with a faster machine that is still slow.",
  },
  report: {
    diagnosis: "Disk saturation caused by an orphaned backup agent, not a hardware capacity shortfall.",
    root: "VaultAgent 6.2 was retired on 01 August when backup moved to Intune, but the uninstall never reached this laptop because it was offline during the removal window. The agent could not contact backup-old.corp.local, treated its catalogue as invalid, and began a full volume scan roughly every 150 seconds — sustaining ~40 MB/s of random reads against a 5400 rpm SATA disk and pushing average response time to over four seconds.",
    fix: "Stopped and disabled the VaultAgent service, uninstalled the product, and removed the device from the legacy application group so it will not be redeployed. Verified disk active time fell from 100% to 3% and Excel cold-launch time from 7m 52s to 4.1s.",
    prevent: "When retiring an agent, follow the uninstall with a fleet query for the service name and target stragglers on next check-in rather than assuming the removal window caught everything. Longer term, schedule the SATA-disk estate for SSD replacement so a single misbehaving process cannot stall the machine.",
  },
},
/* ------------------------------------------------------------------ 06 */
{
  id: "windows-update-failure",
  title: "A cumulative update that will not install",
  category: "Operating System",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104790",
    user: "Sofia Nunes",
    dept: "Legal",
    device: "HP EliteBook 840 — WKS-2205",
    priority: "Medium",
    opened: "10:48",
    issue: "Windows Update repeatedly fails with 0x80070070",
  },
  complaint:
    "Updates keep failing. It nags me every hour, I click retry, it thinks about it for twenty minutes and then says something went wrong. Compliance emailed me saying my laptop is out of date.",
  sim: {
    hostname: "WKS-2205",
    user: "CORP\\snunes",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection I219-V",
      mac: "70-5A-0F-B2-64-31", status: "connected", dhcp: true,
      ip: "10.20.6.44", mask: "255.255.255.0", gw: "10.20.6.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "wsus.corp.local": "10.20.5.60", "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["wmic logicaldisk get size,freespace,caption", `Caption  FreeSpace     Size
C:       1288490188    255129337856
D:       —             —`],
    ],
  },
  stages: [
    "Get the exact failure code",
    "Interpret the code and test it",
    "Reclaim the space the update needs",
    "Retry and confirm",
  ],
  actions: [
    {
      id: "a1", label: "Read Windows Update history", cat: "System", stage: 0,
      out: `[ Settings > Windows Update > Update history ]

2026-08-16 09:12  2026-08 Cumulative Update for Windows 11 (KB5065221)
                  Failed to install — 0x80070070
2026-08-15 22:04  Same update                     Failed — 0x80070070
2026-08-14 22:03  Same update                     Failed — 0x80070070
2026-08-13 22:06  Defender definition 1.427.918.0  Installed successfully

Pattern: only the large cumulative update fails. Small packages install.`,
      ev: "KB5065221 fails with 0x80070070 on every attempt; small definition updates still install successfully.",
      fb: "The code is the whole ticket. Also note the shape of the failure: small packages succeed and only the large one fails, which is a strong hint on its own.",
    },
    {
      id: "a2", label: "Check free space on the system volume", cat: "System", stage: 1, cmd: "wmic logicaldisk get size,freespace,caption",
      ev: "C: has 1.29 GB free of 237 GB. KB5065221 needs roughly 12 GB of working space.",
      fb: "0x80070070 is ERROR_DISK_FULL, and you went and proved it rather than assuming it. 1.29 GB is nowhere near enough for a cumulative update.",
    },
    {
      id: "a3", label: "Reclaim disk space (cleanup, old profiles, component store)", cat: "System", stage: 2,
      out: `[ Disk cleanup — WKS-2205 ]

Previous Windows installation (Windows.old) ....... 21.4 GB  removed
Delivery Optimisation cache ....................... 6.1 GB  removed
Stale user profiles (4 accounts, last use >180d) .. 18.9 GB  removed
Temporary files ................................... 2.2 GB  removed
DISM /Online /Cleanup-Image /StartComponentCleanup
  superseded components ........................... 3.8 GB  removed

C: free space now 53.7 GB of 237 GB.`,
      ev: "Reclaimed 52.4 GB — mostly Windows.old and four stale user profiles. C: now has 53.7 GB free.",
      fb: "Good targets, in a sensible order: the biggest, safest items first. Windows.old and dead profiles are pure reclaim with no risk to the user's data.",
    },
    {
      id: "a4", label: "Retry the update and confirm compliance", cat: "System", stage: 3,
      out: `[ Windows Update — retry ]

KB5065221  Downloading ... 100%
           Installing .... 100%
           Restart required

After restart:
  winver .................. 26H1 (Build 27891.2033)
  Update history .......... KB5065221 Installed successfully 11:38
  Compliance record ....... device reporting compliant`,
      ev: "KB5065221 installs successfully after restart; the device now reports compliant.",
      fb: "Ticket closed on evidence — the build number moved and the compliance record flipped. That's the proof the requester actually needs.",
    },
    {
      id: "b1", label: "Run sfc /scannow", cat: "Console", stage: null,
      out: `Beginning system scan. This process will take some time.

Windows Resource Protection did not find any integrity violations.
Elapsed: 14m 22s`,
      fb: "A defensible instinct — component-store corruption does cause update failures — but it is a fourteen-minute scan you can skip once the error code names a different cause. Read the code first.",
    },
    {
      id: "b2", label: "Reset the Windows Update components", cat: "System", stage: null,
      out: `net stop wuauserv / cryptSvc / bits / msiserver
ren C:\\Windows\\SoftwareDistribution SoftwareDistribution.old
ren C:\\Windows\\System32\\catroot2 catroot2.old
[ services restarted ]

Retry: KB5065221 fails — 0x80070070
Side effect: rebuilding SoftwareDistribution consumed a further 400 MB.`,
      fb: "The standard update-repair ritual applied to a problem it doesn't address, and here it makes things slightly worse by consuming more of the space you don't have.",
    },
    {
      id: "b3", label: "Pause updates for 35 days", cat: "System", stage: null,
      out: `[ Updates paused until 20 September 2026 ]

Compliance record: device remains non-compliant, now with an
explicit deferral flagged to the security team.`,
      fb: "Silencing the alert rather than fixing the fault, on a device that Legal uses. It also leaves an auditable deferral with your name on it.",
    },
    {
      id: "b4", label: "Reimage the laptop", cat: "System", stage: null,
      out: `[ Estimated: 3h build, 1h data restore, 4h user downtime ]`,
      fb: "Four hours of downtime for a problem the error code told you how to fix in ten minutes. Reimaging is a last resort, not a diagnostic.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Insufficient free space on C: — the cumulative update cannot stage its payload", correct: true },
    { id: "d2", text: "The component store (WinSxS) is corrupt" },
    { id: "d3", text: "The device cannot reach the update source" },
    { id: "d4", text: "The SoftwareDistribution folder is damaged" },
    { id: "d5", text: "The update is incompatible with this hardware" },
  ],
  fixes: [
    { id: "f1", text: "Reclaim space (Windows.old, stale profiles, component cleanup), retry the update, and confirm the build number and compliance state", correct: true },
    { id: "f2", text: "Reset the Windows Update components and retry" },
    { id: "f3", text: "Install the update manually from the Microsoft Update Catalogue" },
    { id: "f4", text: "Exclude the device from the update ring" },
  ],
  concept: {
    term: "0x80070070 — ERROR_DISK_FULL",
    body: "Windows error codes ending 0x8007xxxx are Win32 errors wrapped in an HRESULT: strip the 0x8007 prefix and the remainder is the Win32 code in hex. 0x70 is 112 decimal, ERROR_DISK_FULL. Reading the code costs nothing and points straight at the cause, which is why it beats the reflex of running sfc, DISM and a WU component reset in sequence. A cumulative update needs far more free space than the download itself — it stages the payload, builds a new component-store view, and keeps the old one so it can roll back — so a machine with 1-2 GB free will fail every attempt while smaller definition updates keep succeeding.",
  },
  report: {
    diagnosis: "Cumulative update failing because the system volume has insufficient free space.",
    root: "C: had 1.29 GB free of 237 GB. A Windows.old folder left by a feature update (21.4 GB), four abandoned user profiles from staff who left the department (18.9 GB), and an oversized Delivery Optimisation cache (6.1 GB) consumed the volume. KB5065221 requires roughly 12 GB of working space to stage and roll back, so every attempt failed at 0x80070070 while small definition updates continued to install.",
    fix: "Removed Windows.old, the Delivery Optimisation cache, stale profiles and superseded components (DISM StartComponentCleanup), reclaiming 52.4 GB. Retried KB5065221, which installed successfully; confirmed the new build number and a compliant record in the management console.",
    prevent: "Alert on system volumes below 15% free, enable Storage Sense with profile and Windows.old cleanup by policy, and add a free-space precheck to the update ring so devices that cannot succeed are reported rather than retried nightly.",
  },
},
/* ------------------------------------------------------------------ 07 */
{
  id: "wont-boot",
  title: "No bootable device on a warehouse PC",
  category: "Hardware",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104801",
    user: "Alan Reese",
    dept: "Warehouse",
    device: "Dell OptiPlex 3090 — WKS-0987",
    priority: "High",
    opened: "07:05",
    issue: "Workstation will not boot — no bootable device message",
  },
  complaint:
    "First one in this morning, turned it on and it just sits on a black screen with white writing. Goods-in can't be booked until this is up. I didn't do anything to it, it was fine on Friday.",
  sim: {
    hostname: "WKS-0987",
    user: "CORP\\areese",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Realtek PCIe GbE Family Controller",
      mac: "18-C0-4D-77-3E-05", status: "connected", dhcp: true,
      ip: "10.20.14.31", mask: "255.255.255.0", gw: "10.20.14.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
  },
  stages: [
    "Read exactly what the screen says",
    "Inspect what is attached to the machine",
    "Check the boot order",
    "Boot and confirm the drive is healthy",
  ],
  actions: [
    {
      id: "a1", label: "Read the POST message word for word", cat: "Hardware", stage: 0,
      out: `[ Screen — WKS-0987 ]

No bootable device found.
Press F1 to retry boot. Press F2 for setup utility.
Press F5 to run onboard diagnostics.

Note: the machine completed POST. No beep codes, fans and lights normal.`,
      ev: "POST completes cleanly; firmware reports 'No bootable device found' rather than a hardware or Windows error.",
      fb: "The exact wording matters. POST completing tells you the board, CPU and memory are fine — the firmware simply cannot find something to hand off to.",
    },
    {
      id: "a2", label: "Inspect ports and attached media", cat: "Hardware", stage: 1,
      out: `[ Physical inspection ]

Front USB port 1 ..... SanDisk 32 GB flash drive inserted
Front USB port 2 ..... empty
Rear ports ........... keyboard, mouse, display, network
Optical drive ........ none fitted

Flash drive contains a stock-count export and a bootable partition
left over from a vendor firmware tool.`,
      ev: "A USB flash drive with a bootable partition was left in the front port.",
      fb: "Two seconds of looking at the machine. Removable media left in a port is one of the most common causes of this exact message.",
    },
    {
      id: "a3", label: "Check the firmware boot order", cat: "Hardware", stage: 2,
      out: `[ F2 — Setup Utility > Boot Sequence ]

1. USB Storage Device        (enabled)
2. Windows Boot Manager      (enabled)
3. Onboard NIC (PXE)         (enabled)

Secure Boot ......... On
Boot List Option .... UEFI
Last change ......... 12 Aug 2026, by firmware update tool`,
      ev: "USB Storage Device sits first in the boot sequence, ahead of Windows Boot Manager. The order was changed on 12 Aug by a firmware tool.",
      fb: "Now the story is complete: the firmware update tool promoted USB to the top of the list, and the drive left in the port on Friday made that change visible on Monday.",
    },
    {
      id: "a4", label: "Remove the media, restore boot order, verify the drive", cat: "Hardware", stage: 3,
      out: `[ Actions ]

USB flash drive removed and returned to the user.
Boot sequence set: 1. Windows Boot Manager  2. USB  3. NIC
Saved and rebooted.

Windows starts normally, 41s to sign-in screen.
Onboard diagnostics (F5) — NVMe drive: PASS, 0 reallocated blocks,
SMART overall health OK, 4% wear.`,
      ev: "Machine boots to Windows in 41s. NVMe diagnostics pass with no errors.",
      fb: "You fixed the order rather than just pulling the stick, so it cannot recur the next time someone leaves media in — and you proved the drive is healthy before closing.",
    },
    {
      id: "b1", label: "Run Windows Startup Repair from recovery media", cat: "System", stage: null,
      out: `[ Startup Repair ]

"Startup Repair couldn't repair your PC."
Log: C:\\Windows\\System32\\Logfiles\\Srt\\SrtTrail.txt
     Root cause found: no operating system problem detected.

Elapsed: 22 minutes.`,
      fb: "Twenty-two minutes to be told Windows was never broken. Startup Repair fixes the bootloader; it can't fix firmware pointing at the wrong device.",
    },
    {
      id: "b2", label: "Replace the NVMe drive", cat: "Hardware", stage: null,
      out: `[ Parts request raised — 256 GB NVMe, next-day ]

Note: onboard diagnostics were not run before ordering.`,
      fb: "Ordering hardware before running the free diagnostic that is built into the F5 menu. The drive turns out to be healthy, so this is a day of downtime and a wasted part.",
    },
    {
      id: "b3", label: "Reinstall Windows", cat: "System", stage: null,
      out: `[ Warning — destructive action ]

Local D:\\StockExports contains 214 files not covered by OneDrive
backup (folder excluded by policy for the warehouse group).`,
      fb: "Irreversible, and it would destroy uploaded stock data that isn't backed up. Always establish whether the operating system is actually damaged before reinstalling it.",
    },
    {
      id: "b4", label: "Reseat the memory modules", cat: "Hardware", stage: null,
      out: `[ Both DIMMs reseated ]

POST still completes normally. Same message: No bootable device found.`,
      fb: "Memory faults stop POST or throw beep codes. This machine posted cleanly, so RAM was never a candidate.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Firmware is booting to a USB device left in the port because it sits first in the boot sequence", correct: true },
    { id: "d2", text: "The NVMe drive has failed" },
    { id: "d3", text: "The Windows bootloader (BCD) is corrupt" },
    { id: "d4", text: "The memory modules have come loose" },
    { id: "d5", text: "Secure Boot is blocking the operating system" },
  ],
  fixes: [
    { id: "f1", text: "Remove the flash drive, set Windows Boot Manager first in the boot sequence, and confirm the drive passes onboard diagnostics", correct: true },
    { id: "f2", text: "Rebuild the BCD with bootrec /rebuildbcd" },
    { id: "f3", text: "Replace the NVMe drive and restore from image" },
    { id: "f4", text: "Disable Secure Boot" },
  ],
  concept: {
    term: "Where the boot actually fails",
    body: "Boot problems are easy to place if you read the screen. A failure before or during POST — no display, beep codes, diagnostic LEDs — is hardware. 'No bootable device' after a clean POST means firmware walked its boot list and found nothing bootable, which is a boot-order or missing-media problem. 'Operating system not found' or a BCD error means firmware did find a device and the bootloader on it is broken. A stop code on a blue background means Windows started and then failed, which is a driver or kernel problem. Each of those four points at a different set of tools, and the message on screen tells you which one you are in.",
  },
  report: {
    diagnosis: "Boot failure caused by firmware boot order, not by a storage or operating-system fault.",
    root: "A vendor firmware update run on 12 August reset the boot sequence and placed USB Storage Device ahead of Windows Boot Manager. A user flash drive containing a leftover bootable partition was left in the front port on Friday afternoon. On Monday's cold boot the firmware handed control to that partition, which had no valid loader, and stopped with 'No bootable device found'.",
    fix: "Removed the flash drive, restored the boot sequence with Windows Boot Manager first, and confirmed a normal boot in 41 seconds. Ran onboard NVMe diagnostics as a precaution — drive healthy, no reallocated blocks.",
    prevent: "Add a post-firmware-update check of the boot sequence to the maintenance runbook, and set removable boot to disabled in the shared-workstation BIOS profile so leftover media cannot divert a boot.",
  },
},
/* ------------------------------------------------------------------ 08 */
{
  id: "outlook-not-syncing",
  title: "Outlook disconnected after a password change",
  category: "Applications",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104815",
    user: "Rachel Kim",
    dept: "Sales",
    device: "Dell Latitude 7440 — LT-3320",
    priority: "High",
    opened: "11:12",
    issue: "Outlook shows Disconnected and will not sync",
  },
  complaint:
    "Outlook has said Disconnected since yesterday afternoon. It keeps popping up a password box, I type my password, it comes straight back. Mail on my phone is fine and I can see everything in the browser. I have a client proposal sitting in my outbox.",
  sim: {
    hostname: "LT-3320",
    user: "CORP\\rkim",
    dns: "ok",
    adapter: {
      type: "Wireless LAN", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 6E AX211 160MHz",
      mac: "A0-59-50-2B-77-C1", status: "connected", dhcp: true,
      ip: "10.20.9.140", mask: "255.255.255.0", gw: "10.20.9.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "outlook.office365.com": "52.96.104.18", "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["cmdkey /list", `Currently stored credentials:

    Target: MicrosoftOffice16_Data:orgid:rkim@contoso-corp.com
    Type: Generic
    User: rkim@contoso-corp.com
    Saved: 12/06/2026 09:41

    Target: LegacyGeneric:target=msteams
    Type: Generic
    User: rkim@contoso-corp.com`],
    ],
  },
  stages: [
    "Read the client's connection status",
    "Test the mailbox independently of the client",
    "Look at what the client is authenticating with",
    "Clear the stale credential and reconnect",
  ],
  actions: [
    {
      id: "a1", label: "Check Outlook connection status", cat: "Apps", stage: 0,
      out: `[ Ctrl + click the Outlook tray icon > Connection Status ]

Server name              Type       Status         Req/Fail
outlook.office365.com    Mail       Disconnected   88 / 88
outlook.office365.com    Directory  Disconnected   12 / 12

Status bar: "Need Password"    Work Offline: not enabled
Last successful sync: 15 Aug 2026 16:20`,
      ev: "Outlook is genuinely Disconnected with every request failing; Work Offline is not enabled. Last sync 15 Aug 16:20.",
      fb: "Precise starting point. It separates three states users all describe as 'disconnected': Work Offline, an authentication failure, and a dead network path.",
    },
    {
      id: "a2", label: "Confirm the mailbox works in the browser", cat: "Apps", stage: 1,
      out: `[ Outlook on the web — same laptop, same network ]

Sign-in with current password + MFA prompt ......... accepted
Mailbox loads, new mail present, outbox item visible
Send test message .................................. delivered

Conclusion: mailbox, licence, network path and credentials are all fine.
The fault is local to the desktop client.`,
      ev: "OWA works on the same laptop with the current password — mailbox, account and network path are healthy. Fault is client-side.",
      fb: "The cheapest and most decisive test available. One browser sign-in eliminates the service, the account, the licence and the network in a single move.",
    },
    {
      id: "a3", label: "Inspect stored credentials in Credential Manager", cat: "System", stage: 2, cmd: "cmdkey /list",
      ev: "Credential Manager holds a MicrosoftOffice16_Data:orgid entry saved 12 June — before the user's 14 August password change.",
      fb: "This is the find. The client isn't asking you for a password because it has none; it's failing because it has an old one saved and keeps replaying it.",
    },
    {
      id: "a4", label: "Remove the stale credential and re-authenticate", cat: "Apps", stage: 3,
      out: `[ Remediation ]

Closed Outlook.
Removed credential MicrosoftOffice16_Data:orgid:rkim@contoso-corp.com
Cleared the Office identity cache for this profile.
Relaunched Outlook — modern auth prompt shown, MFA approved on device.

Connection Status: Connected (Mail, Directory)   Req/Fail 214 / 0
Outbox cleared — client proposal sent 11:31.`,
      ev: "After removing the stale credential Outlook reconnects, syncs, and the queued proposal sends.",
      fb: "Targeted and quick, and you confirmed the outcome the user actually cared about — the item left her outbox.",
    },
    {
      id: "b1", label: "Toggle Work Offline", cat: "Apps", stage: null,
      out: `[ Send/Receive > Work Offline toggled twice ]

State was already Online. No change to connection status.`,
      fb: "Worth ten seconds in general, and you'd already ruled it out at the first step — the status pane explicitly showed Work Offline was off.",
    },
    {
      id: "b2", label: "Create a new Outlook profile", cat: "Apps", stage: null,
      out: `[ New profile created — 4.2 GB OST rebuild, 38 minutes ]

Result: profile connects successfully.
Side effects: local search index rebuilt, all custom views, rules
ordering and offline archive settings lost and manually rebuilt.`,
      fb: "It works, which is exactly what makes it a trap. A new profile discards the stale credential as a side effect, so you get a fix without ever learning the cause — at the cost of 38 minutes and the user's settings.",
    },
    {
      id: "b3", label: "Run scanpst.exe against the data file", cat: "Apps", stage: null,
      out: `[ Microsoft Outlook Inbox Repair Tool ]

Scanning LT-3320 rkim OST (4.2 GB) ... no errors found.
Elapsed: 26 minutes.`,
      fb: "Data-file corruption presents as missing items, crashes or a client that loads and then hangs — not as repeating authentication prompts against a live server.",
    },
    {
      id: "b4", label: "Reset the user's password again", cat: "User", stage: null,
      out: `[ Password reset requested ]

Identity team response: "The account is healthy — sign-ins from the
browser on the same device are succeeding. Another reset will invalidate
her phone and her saved Wi-Fi certificate for no reason."`,
      fb: "The account already proved itself in the browser two steps ago. Resetting again breaks her working phone and hides the real fault behind fresh symptoms.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Outlook is replaying a cached credential saved before the password change", correct: true },
    { id: "d2", text: "The OST data file is corrupt" },
    { id: "d3", text: "The mailbox is over quota" },
    { id: "d4", text: "The account is locked or disabled" },
    { id: "d5", text: "The laptop cannot reach Exchange Online" },
  ],
  fixes: [
    { id: "f1", text: "Remove the stale Office credential from Credential Manager, clear the identity cache, and re-authenticate with MFA", correct: true },
    { id: "f2", text: "Build a new Outlook profile and rebuild the OST" },
    { id: "f3", text: "Repair the data file with scanpst.exe" },
    { id: "f4", text: "Reset the account password" },
  ],
  concept: {
    term: "Cached credentials versus live authentication",
    body: "Modern Office clients do not prompt for a password on every connection. They exchange one successful sign-in for a refresh token and store it under Credential Manager, so a working client can keep working long after the password behind it has changed. When the password does change, the stored token is invalidated — but the client keeps presenting it, gets refused, and shows a prompt whose result it then discards in favour of the cached entry. The signature is exactly what this user described: mail works everywhere except the desktop client, and the password box reappears immediately after you fill it in. Removing the stored credential forces a fresh authentication, which is why it fixes in two minutes what a profile rebuild fixes in forty.",
  },
  report: {
    diagnosis: "Desktop client authentication failure caused by a stale cached credential.",
    root: "The user changed her password on 14 August. The Office identity entry in Credential Manager (MicrosoftOffice16_Data:orgid, saved 12 June) still held the token issued under the previous password. Outlook replayed that token on every connection attempt, Exchange Online refused it, and the client fell into a prompt-and-fail loop while OWA and the mobile client — which had re-authenticated after the change — continued to work normally.",
    fix: "Closed Outlook, removed the stale MicrosoftOffice16_Data:orgid credential, cleared the Office identity cache, and relaunched. The client presented a modern authentication prompt, MFA was approved, and Connection Status returned to Connected with no failed requests. The queued proposal sent from the outbox.",
    prevent: "Include 'sign out of Office and re-authenticate' in the standard password-change guidance sent to users, and keep the Credential Manager check ahead of profile rebuilds in the mail-connectivity runbook so a two-minute fix is not routinely replaced by a forty-minute one.",
  },
},
/* ------------------------------------------------------------------ 09 */
{
  id: "network-drive",
  title: "A mapped drive with a red X",
  category: "Network",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104822",
    user: "Tom Vega",
    dept: "Engineering",
    device: "HP Z2 Tower — WKS-5510",
    priority: "Medium",
    opened: "11:35",
    issue: "Mapped drive S: unavailable, error 0x80070035",
  },
  complaint:
    "My S: drive has a red X on it and says the network path was not found. Everyone else on the team can get to the same files. I've been off for two weeks if that matters.",
  sim: {
    hostname: "WKS-5510",
    user: "CORP\\tvega",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection I219-LM",
      mac: "3C-52-82-14-6B-90", status: "connected", dhcp: true,
      ip: "10.20.8.72", mask: "255.255.255.0", gw: "10.20.8.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: {
      "corp.local": "10.20.5.10",
      "fs-eng01.corp.local": "10.20.5.44",
      "www.google.com": "142.250.72.68",
    },
    dnsNames: { "10.20.5.10": "dc01.corp.local", "10.20.5.11": "dc02.corp.local" },
    extra: [
      ["net use", `New connections will be remembered.

Status       Local     Remote                    Network
-------------------------------------------------------------------------------
Unavailable  S:        \\\\FS-OLD01\\engineering   Microsoft Windows Network
OK           H:        \\\\corp.local\\dfs\\users\\tvega
The command completed successfully.`],
      ["gpresult /r", `USER SETTINGS
    Last time Group Policy was applied: 01/08/2026 at 08:14:02
    Group Policy was applied from:      dc02.corp.local

    Applied Group Policy Objects
        Engineering - Drive Maps (v14)
        Corp - Baseline User

    Note: drive-map preference "S: -> \\\\corp.local\\dfs\\engineering"
    is set to Replace and has not run on this device since 01 Aug.`],
    ],
  },
  stages: [
    "Find out what the drive is actually mapped to",
    "Test whether that target resolves",
    "Find the current supported path",
    "Reapply policy and confirm",
  ],
  actions: [
    {
      id: "a1", label: "List the mapped drives", cat: "Console", stage: 0, cmd: "net use",
      ev: "S: is a persistent manual mapping to \\\\FS-OLD01\\engineering and shows Unavailable. H: maps via corp.local DFS and is fine.",
      fb: "Straight to the fact everyone assumes they know. The two drives are mapped completely differently, and only the hand-made one is broken.",
    },
    {
      id: "a2", label: "Test name resolution for the server", cat: "Console", stage: 1, cmd: "nslookup fs-old01.corp.local",
      ev: "fs-old01 does not resolve — the record no longer exists in DNS.",
      fb: "Correct next question, and it explains the exact error: 0x80070035 is 'network path not found', which is what you get when the name never becomes an address.",
    },
    {
      id: "a3", label: "Check the drive-map policy and current path", cat: "System", stage: 2, cmd: "gpresult /r",
      ev: "The Engineering drive-map GPO points S: at \\\\corp.local\\dfs\\engineering, but it has not applied on this device since 01 Aug.",
      fb: "This closes the loop between 'his mapping is stale' and 'why is his different from everyone else's'. The policy that would have corrected it never ran while he was away.",
    },
    {
      id: "a4", label: "Remove the stale mapping and reapply policy", cat: "System", stage: 3,
      out: `net use S: /delete
S: was deleted successfully.

gpupdate /force
Updating policy...
Computer Policy update has completed successfully.
User Policy update has completed successfully.

net use
Status       Local     Remote
-------------------------------------------------------------------
OK           S:        \\\\corp.local\\dfs\\engineering
OK           H:        \\\\corp.local\\dfs\\users\\tvega

Opened S:\\Projects\\ — 1,284 items, read/write confirmed.`,
      ev: "S: now maps to the DFS namespace via policy and opens read/write.",
      fb: "Deleting the manual mapping first is the part people miss — a persistent mapping on the same letter blocks the policy preference from applying.",
    },
    {
      id: "b1", label: "Check the user's group membership and share permissions", cat: "User", stage: null,
      out: `[ AD — tvega ]

Member of: Engineering-Staff, Engineering-CAD, All-Users
Share \\\\corp.local\\dfs\\engineering — Engineering-Staff: Change
NTFS — Engineering-Staff: Modify

No membership changes in the last 90 days.`,
      fb: "A sensible thing to check in general, and the error semantics rule it out: permissions produce 'Access is denied', not 'The network path was not found'. Read the error before chasing rights.",
    },
    {
      id: "b2", label: "Reset the user's password", cat: "User", stage: null,
      out: `[ Password reset ]

S: still Unavailable. H: still OK.`,
      fb: "His other mapped drive and his sign-in both work, so authentication was never in doubt. This only creates new problems on his phone and saved sessions.",
    },
    {
      id: "b3", label: "Reinstall the network adapter driver", cat: "System", stage: null,
      out: `[ Driver reinstalled ]

S: still Unavailable. All other network access unaffected throughout.`,
      fb: "The machine is browsing the intranet and holding a working DFS mapping on H:. Networking at the adapter level is demonstrably fine.",
    },
    {
      id: "b4", label: "Map S: directly to the file server by IP address", cat: "System", stage: null,
      out: `net use S: \\\\10.20.5.44\\engineering /persistent:yes
The command completed successfully.

Warning: this bypasses the DFS namespace. If the share moves to another
node the mapping breaks again, and Kerberos falls back to NTLM when the
target is an IP address rather than a name.`,
      fb: "It gets the user working today and rebuilds tomorrow's ticket. Hard-coding a server behind a namespace is what created this problem in the first place.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "A persistent manual mapping points at a decommissioned server that no longer resolves", correct: true },
    { id: "d2", text: "The user was removed from the Engineering security group" },
    { id: "d3", text: "The file server is down" },
    { id: "d4", text: "The workstation has lost its network connection" },
    { id: "d5", text: "The user's password has expired" },
  ],
  fixes: [
    { id: "f1", text: "Delete the manual S: mapping, run gpupdate so the drive-map policy applies, and confirm access through the DFS namespace", correct: true },
    { id: "f2", text: "Map S: to the file server's IP address" },
    { id: "f3", text: "Re-add the user to Engineering-Staff" },
    { id: "f4", text: "Recreate the user's Windows profile" },
  ],
  concept: {
    term: "Error semantics: path not found versus access denied",
    body: "Windows file-sharing errors are precise, and they split the problem in half before you touch anything. 0x80070035 'The network path was not found' means the name never resolved or nothing answered on port 445 — a naming, routing or server-availability problem. 'Access is denied' means the server was found and answered, and it refused you — a permissions or authentication problem. Chasing group membership on a path-not-found error, or checking DNS on an access-denied error, is how tickets stretch from ten minutes to an afternoon. The second lesson here is architectural: a namespace like \\\\corp.local\\dfs\\engineering survives server migrations, while a hand-typed \\\\SERVER\\share does not.",
  },
  report: {
    diagnosis: "Stale persistent drive mapping to a decommissioned file server.",
    root: "S: was mapped by hand to \\\\FS-OLD01\\engineering with the persistent flag, so it was restored at every sign-in from the user's own profile. FS-OLD01 was retired during the file-server consolidation and its DNS record removed, producing 0x80070035. Colleagues were unaffected because the Engineering drive-map policy replaced their S: with the DFS namespace on 01 August — a policy cycle this workstation missed because the user was on leave and the device was powered off.",
    fix: "Deleted the persistent S: mapping, ran gpupdate /force so the Engineering drive-map preference could apply, and confirmed S: now resolves through \\\\corp.local\\dfs\\engineering with read/write access to the project folders.",
    prevent: "Audit for persistent manual mappings before retiring a server, and keep decommissioned DNS records as a CNAME to the namespace for one policy cycle so stragglers fail soft rather than hard.",
  },
},
/* ------------------------------------------------------------------ 10 */
{
  id: "wifi-failure",
  title: "Corporate Wi-Fi rejects a returning laptop",
  category: "Network",
  difficulty: "Advanced",
  ticket: {
    num: "INC-104834",
    user: "Nina Boyd",
    dept: "Field Services",
    device: "Dell Latitude 5450 — LT-4401",
    priority: "High",
    opened: "12:02",
    issue: "Laptop cannot associate with CORP-SECURE; guest SSID works",
  },
  complaint:
    "My laptop won't join CORP-SECURE any more. It tries, spins, and says it can't connect. If I join the guest Wi-Fi it works fine but then nothing internal opens. I've been out on site for about two months.",
  sim: {
    hostname: "LT-4401",
    user: "CORP\\nboyd",
    dns: "ok",
    adapter: {
      type: "Wireless LAN", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 6E AX211 160MHz",
      mac: "E8-2A-44-90-1D-3F", status: "connected", dhcp: true,
      ip: "172.31.4.88", mask: "255.255.255.0", gw: "172.31.4.1",
      dns: ["1.1.1.1"], dhcpServer: "172.31.4.1", suffix: "guest.corp.local",
    },
    reach: { default: true, "10.20.5.10": false, "10.20.5.11": false },
    resolve: { "www.google.com": "142.250.72.68" },
    dnsNames: { "1.1.1.1": "one.one.one.one" },
    extra: [
      ["netsh wlan show interfaces", `There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6E AX211 160MHz
    State                  : connected
    SSID                   : CORP-GUEST
    Authentication         : Open
    Signal                 : 91%

    Profile CORP-SECURE is present.
    Last connection attempt : failed
    Reason                  : 0x0000274c — authentication timed out`],
      ["netsh wlan show profile name=CORP-SECURE", `Profile CORP-SECURE on interface Wi-Fi:

    SSID name           : "CORP-SECURE"
    Authentication      : WPA2-Enterprise
    Cipher              : CCMP
    EAP type            : Microsoft: Smart Card or other certificate (EAP-TLS)
    Auth mode           : User authentication
    Validate server cert: Yes  (Root: CORP Issuing CA 02)`],
    ],
  },
  stages: [
    "Read the adapter and the failure reason",
    "Find the authentication error in the log",
    "Inspect the certificate the profile relies on",
    "Renew the certificate and reconnect",
  ],
  actions: [
    {
      id: "a1", label: "Show the wireless interface and profile", cat: "Console", stage: 0, cmd: "netsh wlan show interfaces",
      ev: "Adapter is healthy and associated to CORP-GUEST at 91% signal. CORP-SECURE attempts fail with 0x274c — authentication timed out.",
      fb: "Good: this proves the radio, the driver and the antennas all work, so whatever is wrong sits in authentication rather than in hardware.",
    },
    {
      id: "a2", label: "Read the WLAN-AutoConfig event log", cat: "System", stage: 1,
      out: `[ Event Viewer — Microsoft-Windows-WLAN-AutoConfig/Operational ]

11:58:02  Event 12013  Wireless security failed.
                       Network: CORP-SECURE
                       Reason: Explicit EAP failure received
11:58:02  Event 12012  EAP identity: CORP\\nboyd
                       EAP method: EAP-TLS
                       Error: 0x80420100
                       "The certificate used for authentication has expired."
11:58:04  Event 8002   NAP Agent: no valid client certificate available.`,
      ev: "EAP-TLS fails with 0x80420100 — the certificate used for authentication has expired.",
      fb: "The log names the failure exactly. 'Authentication timed out' at the adapter is the generic version of a very specific error one layer down.",
    },
    {
      id: "a3", label: "Inspect the client certificate store", cat: "System", stage: 2,
      out: `[ certmgr.msc — Personal > Certificates (current user) ]

Issued To    Issued By              Expires      Template
nboyd        CORP Issuing CA 02     13/08/2026   Corp-User-Auth
                                    EXPIRED 3 days ago

Template Corp-User-Auth:
    Validity 1 year, renewal window 6 weeks
    Autoenrolment: on, requires a domain-connected session
Device last on the corporate network: 14/06/2026 (63 days ago)`,
      ev: "The EAP-TLS user certificate expired on 13 Aug. Autoenrolment needs a domain-connected session, and the device has been off the corporate network for 63 days.",
      fb: "This is the causal chain in one screen: the renewal window opened while the laptop was on site, autoenrolment never got a domain connection, and the certificate lapsed.",
    },
    {
      id: "a4", label: "Get a domain-connected session and force enrolment", cat: "System", stage: 3,
      out: `[ Remediation ]

Connected LT-4401 to a wired dock (domain-reachable).
gpupdate /force ....................... completed
certutil -pulse ....................... autoenrolment triggered

New certificate issued: nboyd, CORP Issuing CA 02,
valid 16/08/2026 - 16/08/2027, template Corp-User-Auth.

Undocked and reconnected to CORP-SECURE:
    State  : connected
    SSID   : CORP-SECURE
    Auth   : WPA2-Enterprise, EAP-TLS
    IPv4   : 10.20.9.211  gateway 10.20.9.1
Internal resources reachable.`,
      ev: "New certificate issued and CORP-SECURE authenticates; laptop receives a corporate address and reaches internal resources.",
      fb: "The right shape of fix: you gave the machine the one thing it needed — a domain-connected session — rather than rebuilding anything.",
    },
    {
      id: "b1", label: "Forget the network and re-enter the credentials", cat: "System", stage: null,
      out: `[ CORP-SECURE profile removed and recreated by hand ]

Reconnect attempt: fails, 0x274c.
Side effect: the GPO-provisioned profile settings (server certificate
validation, root CA pinning) were replaced with weaker manual settings.`,
      fb: "The standard consumer Wi-Fi fix, and on an enterprise network it makes things worse. EAP-TLS authenticates with a certificate, not a password, so there is nothing to re-enter — and you have just discarded the policy-managed profile.",
    },
    {
      id: "b2", label: "Reinstall the wireless adapter driver", cat: "System", stage: null,
      out: `[ Intel Wi-Fi 6E AX211 driver reinstalled — 23.60.1 ]

CORP-GUEST still connects at 91%. CORP-SECURE still fails, 0x274c.`,
      fb: "The same radio associates with the guest SSID at full signal. A driver that works on one network and not another isn't a driver fault.",
    },
    {
      id: "b3", label: "Raise a ticket against the access point", cat: "Escalation", stage: null,
      out: `[ NET-OPS response ]

"AP-3F-02 currently has 41 clients authenticated on CORP-SECURE.
RADIUS log for E8-2A-44-90-1D-3F shows Access-Reject, reason
'client certificate expired'. This is a client-side issue."`,
      fb: "Forty-one other clients are authenticating through the same AP, and the RADIUS log hands you the answer you could have read locally. Shared infrastructure is the last suspect for a single-client failure.",
    },
    {
      id: "b4", label: "Reset the network stack (netsh winsock reset)", cat: "Console", stage: null,
      out: `Sucessfully reset the Winsock Catalog.
You must restart the computer to complete this action.

After restart: CORP-SECURE fails, 0x274c.`,
      fb: "A generic remedy for a specific, well-logged error. The stack was demonstrably fine — it was passing guest traffic the whole time.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "The EAP-TLS client certificate has expired and autoenrolment could not renew it off-network", correct: true },
    { id: "d2", text: "The wireless driver is faulty" },
    { id: "d3", text: "The access point is rejecting all clients" },
    { id: "d4", text: "The user's password has changed" },
    { id: "d5", text: "The wireless profile is corrupt" },
  ],
  fixes: [
    { id: "f1", text: "Give the device a domain-connected session, force autoenrolment to issue a new certificate, and reconnect to CORP-SECURE", correct: true },
    { id: "f2", text: "Rebuild the CORP-SECURE profile manually" },
    { id: "f3", text: "Move the user permanently onto the guest network with VPN" },
    { id: "f4", text: "Replace the wireless card" },
  ],
  concept: {
    term: "802.1X and EAP-TLS",
    body: "On a WPA2-Enterprise network the access point is not the thing that decides whether you get in. It acts as an authenticator, relaying EAP messages between the client and a RADIUS server, and only opens the port once RADIUS returns Access-Accept. With EAP-TLS the credential is a certificate, so the usual password troubleshooting has nothing to act on: there is no password to re-enter and forgetting the network only discards the managed profile. Certificates issued by autoenrolment renew inside a window before expiry, and that renewal needs a session where the device can reach a domain controller and the CA. A laptop that spends months on site can sail past its renewal window, and the failure only appears the day it returns to the office.",
  },
  report: {
    diagnosis: "802.1X authentication failure caused by an expired EAP-TLS client certificate.",
    root: "The user-authentication certificate issued from template Corp-User-Auth expired on 13 August. Autoenrolment would normally have renewed it six weeks earlier, but renewal requires a session in which the device can reach a domain controller and the issuing CA, and LT-4401 had been off the corporate network for 63 days on a field assignment. With no valid certificate, RADIUS returned Access-Reject and the client reported the generic 'authentication timed out' (0x274c).",
    fix: "Connected the laptop to a domain-reachable wired dock, ran gpupdate /force and certutil -pulse to trigger autoenrolment, and confirmed a new certificate valid to 16 August 2027. Reconnected to CORP-SECURE, verified EAP-TLS authentication, a corporate DHCP lease and access to internal resources.",
    prevent: "Report on certificates approaching expiry for devices that have not checked in recently, and allow certificate autoenrolment over the always-on VPN so field devices renew without returning to an office.",
  },
},
/* ------------------------------------------------------------------ 11 */
{
  id: "account-locked",
  title: "An account that locks again every twenty minutes",
  category: "Identity",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104841",
    user: "Derek Ash",
    dept: "Customer Service",
    device: "Dell OptiPlex 7010 — WKS-1120",
    priority: "High",
    opened: "12:20",
    issue: "Repeated account lockouts, third occurrence this week",
  },
  complaint:
    "Locked out again. This is the third time this week. Someone unlocks it, I get maybe twenty minutes of work done and it locks again. I'm typing my password correctly, I promise.",
  sim: {
    hostname: "WKS-1120",
    user: "CORP\\dash",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Realtek PCIe GbE Family Controller",
      mac: "2C-F0-5D-88-14-A2", status: "connected", dhcp: true,
      ip: "10.20.12.55", mask: "255.255.255.0", gw: "10.20.12.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "corp.local": "10.20.5.10", "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local", "10.20.5.11": "dc02.corp.local" },
    extra: [
      ["net user dash /domain", `The request will be processed at a domain controller for domain corp.local.

User name                    dash
Full Name                    Derek Ash
Account active               Locked
Account expires              Never

Password last set            10/08/2026 09:02:11
Password expires             08/11/2026 09:02:11
Password changeable          11/08/2026 09:02:11
Last logon                   16/08/2026 12:04:39

Logon hours allowed          All
The command completed successfully.`],
    ],
  },
  stages: [
    "Confirm the lockout state",
    "Find where the bad passwords are coming from",
    "Identify what is holding the old password",
    "Clear it and confirm the lockout stops",
  ],
  actions: [
    {
      id: "a1", label: "Check the account status", cat: "User", stage: 0, cmd: "net user dash /domain",
      ev: "Account is locked. Password was last set 10 Aug and is not expiring — so this is a lockout, not an expiry.",
      fb: "Worth doing even when the ticket title tells you the answer: it separates 'locked' from 'expired' and gives you the date the password changed, which turns out to matter.",
    },
    {
      id: "a2", label: "Find the lockout source in the security log", cat: "Server", stage: 1,
      out: `[ PDC emulator DC01 — Security log, Event 4740 ]

12:04:39  Account Name : dash
          Caller Computer Name : MOBILE-DASH-IPHONE
12:23:10  Account Name : dash
          Caller Computer Name : MOBILE-DASH-IPHONE
12:41:55  Account Name : dash
          Caller Computer Name : MOBILE-DASH-IPHONE

Related Event 4771 (Kerberos pre-authentication failed), same source,
repeating every ~4 minutes since 10/08/2026 09:15.`,
      ev: "Every 4740 lockout names the same caller: MOBILE-DASH-IPHONE, failing every ~4 minutes since 10 Aug 09:15.",
      fb: "This is the step that separates treating the symptom from finding the cause. Event 4740 on the PDC emulator names the machine presenting the bad password.",
    },
    {
      id: "a3", label: "Check what that device is authenticating with", cat: "User", stage: 2,
      out: `[ Device inventory — MOBILE-DASH-IPHONE ]

Enrolment .............. personal device, mail profile only
Mail account ........... corp.local Exchange ActiveSync (legacy basic auth)
Credential saved ....... 04/07/2026
Password changed on the account: 10/08/2026 09:02

The mail profile has been retrying the pre-change password every
4 minutes for six days.`,
      ev: "The user's phone holds a mail profile with the pre-change password saved, retrying every 4 minutes since the change on 10 Aug.",
      fb: "The timeline lines up exactly with the password change, which is what lets you say this is the cause rather than a coincidence.",
    },
    {
      id: "a4", label: "Update the saved credential and unlock the account", cat: "User", stage: 3,
      out: `[ Remediation ]

Removed the stale mail profile from the phone and re-added it with
the current password and modern authentication.
Unlocked the account on DC01.

Monitoring 4740/4771 for 90 minutes: no further events.
User signed in and remained signed in for the rest of the shift.`,
      ev: "Stale profile replaced, account unlocked, no further 4740 or 4771 events in 90 minutes of monitoring.",
      fb: "You verified with a quiet period rather than declaring victory at the unlock. Watching the log is what proves the loop is actually broken.",
    },
    {
      id: "b1", label: "Unlock the account and close the ticket", cat: "User", stage: null,
      out: `[ Account unlocked 12:22 ]

12:41  Event 4740 — account dash locked out again.
       Caller Computer Name: MOBILE-DASH-IPHONE`,
      fb: "This is exactly what has already happened twice this week. Unlocking without finding the source is why the user is on their third ticket.",
    },
    {
      id: "b2", label: "Reset the user's password", cat: "User", stage: null,
      out: `[ Password reset, user chooses a new one ]

12:52  Event 4740 — account dash locked out again.
       Caller Computer Name: MOBILE-DASH-IPHONE

The phone is still presenting the old password; a new password does
not change what the phone has saved.`,
      fb: "It feels decisive and it changes nothing. Whatever is replaying an old password will keep replaying it after the reset — often faster, because the mismatch is now guaranteed.",
    },
    {
      id: "b3", label: "Raise the lockout threshold for this user", cat: "Escalation", stage: null,
      out: `[ Request declined — Security ]

"Lockout threshold is a domain policy and applies to every account.
We are not weakening a control to accommodate one misconfigured
device. Find the source."`,
      fb: "Turning off the alarm because you can't find the fire. It also can't be scoped to one user — this control is domain-wide.",
    },
    {
      id: "b4", label: "Reimage the workstation", cat: "System", stage: null,
      out: `[ Build complete — 3h ]

12:41 on the following day: Event 4740 — account dash locked out.
Caller Computer Name: MOBILE-DASH-IPHONE`,
      fb: "The lockout follows the account, not the workstation, so rebuilding the desk PC cannot touch it. The 4740 events were pointing at a different device the whole time.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "A mobile mail profile is replaying the pre-change password and locking the account", correct: true },
    { id: "d2", text: "The user is mistyping their password" },
    { id: "d3", text: "The account is under a brute-force attack from the internet" },
    { id: "d4", text: "The workstation has a corrupt credential cache" },
    { id: "d5", text: "The domain lockout policy is too aggressive" },
  ],
  fixes: [
    { id: "f1", text: "Re-add the phone's mail profile with the current password and modern auth, unlock the account, and monitor 4740 until it stays quiet", correct: true },
    { id: "f2", text: "Unlock the account and ask the user to type carefully" },
    { id: "f3", text: "Reset the password to something simpler" },
    { id: "f4", text: "Exempt the account from the lockout policy" },
  ],
  concept: {
    term: "Event 4740 and the lockout source",
    body: "When an account exceeds the bad-password threshold the domain controller that processes the lockout writes Event 4740 to its Security log, and the PDC emulator receives a copy of every lockout in the domain — so that one log tells you about lockouts happening anywhere. The field that matters is Caller Computer Name: the machine that presented the wrong password. Repeat lockouts almost never come from a user typing badly; they come from something replaying a saved credential on a timer — a phone mail profile, a mapped drive under a service account, a scheduled task, a stored RDP session, or a service still running as the user. The tell is the interval: humans fail at random, machines fail every four minutes exactly.",
  },
  report: {
    diagnosis: "Repeating account lockout driven by a stale cached credential on a personal mobile device.",
    root: "The user changed their password on 10 August at 09:02. Their personal iPhone held an Exchange ActiveSync mail profile using legacy basic authentication with the pre-change password saved since 4 July. The profile retried every four minutes, exceeding the domain bad-password threshold within twenty minutes of each unlock and producing Event 4740 on DC01 with caller MOBILE-DASH-IPHONE.",
    fix: "Removed and re-created the mail profile on the phone using the current password and modern authentication, then unlocked the account. Monitored Events 4740 and 4771 on the PDC emulator for 90 minutes with no further failures, and confirmed the user completed the shift without a further lockout.",
    prevent: "Retire legacy basic authentication for ActiveSync so mobile clients cannot replay static passwords, and include 'update saved passwords on phones and tablets' in the password-change guidance. For repeat lockouts, make Event 4740 source identification the first step in the runbook rather than an unlock.",
  },
},
/* ------------------------------------------------------------------ 12 */
{
  id: "password-expired",
  title: "Signed in at home, refused by everything",
  category: "Identity",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104856",
    user: "Alice Fournier",
    dept: "Procurement",
    device: "Dell Latitude 5540 — LT-2870",
    priority: "Medium",
    opened: "13:05",
    issue: "Laptop signs in but all corporate services reject credentials",
  },
  complaint:
    "I can log into my laptop at home exactly like normal, but nothing works once I'm in. Teams asks for a password and won't take it, the shared drives are gone, and Outlook keeps prompting. My password definitely hasn't changed.",
  sim: {
    hostname: "LT-2870",
    user: "CORP\\afournier",
    dns: "ok",
    adapter: {
      type: "Wireless LAN", name: "Wi-Fi", desc: "Intel(R) Wi-Fi 6 AX201 160MHz",
      mac: "5C-80-B6-31-77-0E", status: "connected", dhcp: true,
      ip: "192.168.1.34", mask: "255.255.255.0", gw: "192.168.1.1",
      dns: ["192.168.1.1"], dhcpServer: "192.168.1.1", suffix: "home",
    },
    reach: { default: true, "10.20.5.10": false, "10.20.5.11": false },
    resolve: { "www.google.com": "142.250.72.68", "vpn.corp.com": "203.0.113.40" },
    dnsNames: { "192.168.1.1": "router.home" },
    extra: [
      ["net user afournier /domain", `The request will be processed at a domain controller for domain corp.local.

User name                    afournier
Full Name                    Alice Fournier
Account active               Yes
Account locked               No

Password last set            18/05/2026 08:31:04
Password expires             15/08/2026 08:31:04   ** EXPIRED **
User must change password at next logon    Yes

The command completed successfully.`],
      ["klist", `Current LogonId is 0:0x4a2f1

Cached Tickets: (0)

[ No Kerberos tickets. This session was authenticated from the local
  cached credential store, not from a domain controller. ]`],
    ],
  },
  stages: [
    "Check the account, not the laptop",
    "Explain why the laptop still signs in",
    "Restore a path to a domain controller",
    "Change the password and re-authenticate",
  ],
  actions: [
    {
      id: "a1", label: "Query the account state on the domain", cat: "User", stage: 0, cmd: "net user afournier /domain",
      ev: "Account is active and not locked, but the password expired on 15 Aug and 'user must change password at next logon' is set.",
      fb: "The right first move, and it contradicts the user's own report in a useful way — she is right that she didn't change it, and that is precisely the problem.",
    },
    {
      id: "a2", label: "Check whether the session has Kerberos tickets", cat: "Console", stage: 1, cmd: "klist",
      ev: "Zero cached Kerberos tickets — the desktop sign-in came from cached credentials, with no domain controller involved.",
      fb: "This is the piece that makes the whole picture make sense: the laptop let her in without ever asking a domain controller, so it had no way to know the password had expired.",
    },
    {
      id: "a3", label: "Establish a path to a domain controller", cat: "Network", stage: 2,
      out: `[ Before ]
ping 10.20.5.10  ->  Request timed out.   (no corporate route)

[ VPN connected — vpn.corp.com, certificate authentication ]
ping 10.20.5.10  ->  Reply from 10.20.5.10: bytes=32 time=38ms TTL=124
nltest /dsgetdc:corp.local
      DC: \\\\DC02.corp.local   Flags: PDC KDC WRITABLE
      The command completed successfully.

Note: the VPN uses a machine certificate, so it connects without the
user password — which is what makes this route available at all.`,
      ev: "Over VPN the laptop reaches DC02. The tunnel authenticates with a machine certificate, so it works despite the expired password.",
      fb: "Sequenced correctly. The password cannot be changed against a domain controller the machine cannot reach, so connectivity has to come first.",
    },
    {
      id: "a4", label: "Change the password over the tunnel and re-authenticate", cat: "User", stage: 3,
      out: `[ Ctrl + Alt + Del > Change a password ]

Old password accepted (expired passwords are still valid for the change).
New password set, complexity and history requirements met.

klist
    Cached Tickets: (4)   krbtgt/CORP.LOCAL, cifs/fs01, ...

Teams .............. signed in
Outlook ............ Connected, sync complete
Mapped drives ...... H: and S: reconnected`,
      ev: "Password changed over the tunnel, Kerberos tickets issued, and Teams, Outlook and mapped drives all reconnect.",
      fb: "Fixed at the source, with the user doing the change herself so the new password is never known to anyone else.",
    },
    {
      id: "b1", label: "Unlock the account", cat: "User", stage: null,
      out: `[ Unlock requested ]

Account is not locked — no action taken.`,
      fb: "Expired and locked are different states with different fixes, and the account query already showed which one this is. Locked means too many bad attempts; expired means the clock ran out.",
    },
    {
      id: "b2", label: "Reset the password from the admin console", cat: "User", stage: null,
      out: `[ Password reset to a temporary value ]

The user is still off the corporate network, so her laptop continues
to sign in with the old cached credential. Her local profile password
and the domain password now differ, and DPAPI-protected items
(saved Wi-Fi keys, stored browser credentials) fail to decrypt.`,
      fb: "This is the trap in the scenario. An admin-side reset while the machine is off-network splits the cached credential from the domain one and breaks DPAPI-protected secrets — more damage than the original ticket.",
    },
    {
      id: "b3", label: "Rebuild the Windows user profile", cat: "System", stage: null,
      out: `[ Profile rebuild — 90 minutes, user data migrated ]

New profile signs in from cache exactly as before.
Corporate services still reject the credential.`,
      fb: "The profile was never the problem. The rejection is happening at the domain, and a new profile inherits the same expired password.",
    },
    {
      id: "b4", label: "Add the user to a group that exempts password expiry", cat: "Escalation", stage: null,
      out: `[ Request declined — Security ]

"Password-never-expires is reserved for approved service accounts and
requires a documented exception. It is not a fix for an expired user
password."`,
      fb: "Removing the control instead of completing the change, and it wouldn't even help — the flag stops future expiry, it doesn't clear the one already set.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "The domain password has expired; the laptop keeps signing in from cached credentials off-network", correct: true },
    { id: "d2", text: "The account is locked out" },
    { id: "d3", text: "The Windows user profile is corrupt" },
    { id: "d4", text: "The home internet connection is blocking corporate services" },
    { id: "d5", text: "The laptop has lost its domain trust relationship" },
  ],
  fixes: [
    { id: "f1", text: "Connect the VPN so a domain controller is reachable, have the user change the password with Ctrl+Alt+Del, then confirm tickets and services", correct: true },
    { id: "f2", text: "Reset the password from the admin console and email it to the user" },
    { id: "f3", text: "Rebuild the user profile" },
    { id: "f4", text: "Set the account to never expire" },
  ],
  concept: {
    term: "Cached credentials versus live authentication",
    body: "Windows stores a verifier for the last several domain sign-ins so a laptop can be used away from the corporate network. When no domain controller is reachable, sign-in is validated against that cache — which means the desktop unlocks with a password the domain has already retired. Everything that authenticates live (Kerberos tickets, mapped drives, Teams, Exchange) fails at the same moment, which is why the user experiences 'my laptop works but nothing in it does'. An empty klist output is the giveaway: no Kerberos tickets means no domain controller was ever consulted. The change must be made against a live DC, and an admin-side reset while the machine is off-network makes it worse by desynchronising the cached credential and breaking DPAPI-protected secrets.",
  },
  report: {
    diagnosis: "Expired domain password, masked by cached-credential sign-in on a remote device.",
    root: "The password was last set on 18 May and expired on 15 August under the 90-day policy. The laptop had been working from home without VPN, so interactive sign-in was validated against the local cached verifier and continued to succeed. Every service that authenticates against the domain — Kerberos, SMB, Exchange, Teams — refused the retired password, producing repeated prompts and missing drives.",
    fix: "Connected the certificate-authenticated VPN so DC02 was reachable, confirmed the domain controller with nltest, and had the user change her own password through Ctrl+Alt+Del. Verified Kerberos tickets were issued and that Outlook, Teams and both mapped drives reconnected.",
    prevent: "Send expiry warnings to personal contact addresses as well as corporate mail so remote users see them, and use an always-on VPN or cloud-joined identity so password changes reach a controller without a manual tunnel. Add 'check klist and account expiry before resetting anything' to the remote-access runbook.",
  },
},
/* ------------------------------------------------------------------ 13 */
{
  id: "app-wont-launch",
  title: "An application that closes itself",
  category: "Applications",
  difficulty: "Intermediate",
  ticket: {
    num: "INC-104863",
    user: "Victor Hale",
    dept: "Design",
    device: "HP Z2 Mini — WKS-3407",
    priority: "Medium",
    opened: "13:40",
    issue: "ProjectPlanner exits immediately on launch, no error shown",
  },
  complaint:
    "ProjectPlanner opens for about a second — I see the window appear — and then it just vanishes. No error, no message, nothing. It worked yesterday. Two other people on the design floor say the same thing.",
  sim: {
    hostname: "WKS-3407",
    user: "CORP\\vhale",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Connection I219-LM",
      mac: "48-0F-CF-2A-91-77", status: "connected", dhcp: true,
      ip: "10.20.10.28", mask: "255.255.255.0", gw: "10.20.10.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["where projectplanner", `C:\\ProgramData\\PlannerCorp\\ProjectPlanner\\ProjectPlanner.exe`],
    ],
  },
  stages: [
    "Reproduce it and note exactly what happens",
    "Find where a silent exit gets logged",
    "Compare the block against the rule that caused it",
    "Correct the rule and confirm across the affected users",
  ],
  actions: [
    {
      id: "a1", label: "Reproduce the launch and observe", cat: "Apps", stage: 0,
      out: `[ Observed launch — WKS-3407 ]

Double-click ProjectPlanner .... splash window appears
                                 process exits after 0.9s
Exit code ...................... 0xC0000022 (STATUS_ACCESS_DENIED)
No error dialog, no crash dialog, nothing in the Application log.

where projectplanner
C:\\ProgramData\\PlannerCorp\\ProjectPlanner\\ProjectPlanner.exe`,
      ev: "Process exits after 0.9s with 0xC0000022 (access denied). No crash dialog. Binary now lives in C:\\ProgramData\\PlannerCorp.",
      fb: "Reproducing first gives you two facts worth more than any guess: the exit code says access denied rather than a crash, and the binary is running from an unusual path.",
    },
    {
      id: "a2", label: "Check the AppLocker operational log", cat: "System", stage: 1,
      out: `[ Event Viewer — Microsoft-Windows-AppLocker/EXE and DLL ]

13:38:41  Event 8004
  %OSDRIVE%\\PROGRAMDATA\\PLANNERCORP\\PROJECTPLANNER\\PROJECTPLANNER.EXE
  was prevented from running.
  User: CORP\\vhale

13:12:07  Event 8004  same path, User: CORP\\jodell
12:55:19  Event 8004  same path, User: CORP\\rmarsh

Application log for the same period: no entries for this process.`,
      ev: "AppLocker Event 8004 blocks the executable for three different users. Nothing appears in the Application log at all.",
      fb: "This is the step that makes the invisible visible. A blocked process never gets far enough to crash, so it leaves nothing in the Application log — the evidence is in the AppLocker channel.",
    },
    {
      id: "a3", label: "Compare the install path against the AppLocker rules", cat: "System", stage: 2,
      out: `[ AppLocker policy — Executable rules ]

Allow  Everyone   %PROGRAMFILES%\\*                     (path rule)
Allow  Everyone   %WINDIR%\\*                           (path rule)
Allow  Design     Publisher: O=PLANNERCORP LTD,
                  Product: PROJECTPLANNER, File version 4.* and above
Deny   Everyone   %OSDRIVE%\\PROGRAMDATA\\*             (path rule)

[ Change record ]
ProjectPlanner 5.0 deployed 15/08 22:10. The 5.0 installer relocates
the binary from C:\\Program Files\\PlannerCorp to C:\\ProgramData\\PlannerCorp
and is signed as "O=PLANNERCORP LIMITED" — the publisher rule specifies
"PLANNERCORP LTD", so it no longer matches.`,
      ev: "The v5 installer moved the binary into %PROGRAMDATA%, which is explicitly denied, and its signing name changed from 'PLANNERCORP LTD' to 'PLANNERCORP LIMITED' so the publisher rule no longer matches.",
      fb: "Both halves matter. Even without the deny rule the publisher allow would have stopped matching, so this fails twice over — and that's what makes the fix a policy change rather than a reinstall.",
    },
    {
      id: "a4", label: "Update the rule, refresh policy, verify for all affected users", cat: "System", stage: 3,
      out: `[ Remediation ]

Publisher rule updated to O=PLANNERCORP LIMITED, Product PROJECTPLANNER,
file version 5.0 and above, scoped to the Design group.
Deny rule for %OSDRIVE%\\PROGRAMDATA\\* retained (it is a sound control).

gpupdate /force on WKS-3407 ......... policy applied
ProjectPlanner launches, stays open, opens an existing project file.

Verified on WKS-3402 (jodell) and WKS-3411 (rmarsh) — both launch.
AppLocker 8004 events: none since 14:06.`,
      ev: "Updated publisher rule applied; the application launches for all three affected users and no further 8004 events are logged.",
      fb: "You kept the security control and fixed the rule, then confirmed on the other two machines rather than closing on a sample of one.",
    },
    {
      id: "b1", label: "Reinstall the application", cat: "Apps", stage: null,
      out: `[ ProjectPlanner 5.0 removed and redeployed ]

Installer places the binary at C:\\ProgramData\\PlannerCorp\\ — the same
denied path. Launch behaviour unchanged: exits after 0.9s.`,
      fb: "The reflex fix, and here it reinstalls into the exact location that is blocked. Reinstalling only helps when the installed files are the thing that's wrong.",
    },
    {
      id: "b2", label: "Run the application as administrator", cat: "Apps", stage: null,
      out: `[ Run as administrator — UAC approved ]

Process exits after 0.9s. Exit code 0xC0000022.
AppLocker Event 8004 logged for the elevated attempt as well.`,
      fb: "Cheap to try and genuinely informative — application control applies to administrators too, so failing while elevated rules out a permissions problem on the files themselves.",
    },
    {
      id: "b3", label: "Delete the user's application settings folder", cat: "Apps", stage: null,
      out: `[ %APPDATA%\\PlannerCorp removed ]

Launch behaviour unchanged. User's saved layouts and recent files lost.`,
      fb: "A profile-corruption fix aimed at a problem that isn't in the profile — and three users failing identically at the same minute already argued against anything per-user.",
    },
    {
      id: "b4", label: "Update the graphics driver", cat: "System", stage: null,
      out: `[ NVIDIA T400 driver updated — 561.09 ]

No change. Application still exits after 0.9s.`,
      fb: "Graphics faults show up as crashes, hangs or rendering artefacts, not as an immediate clean exit with an access-denied code.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Application control (AppLocker) is blocking the relocated v5 binary", correct: true },
    { id: "d2", text: "The application installation is corrupt" },
    { id: "d3", text: "The user's profile is damaged" },
    { id: "d4", text: "A missing runtime prevents the application from starting" },
    { id: "d5", text: "Antivirus has quarantined the executable" },
  ],
  fixes: [
    { id: "f1", text: "Update the AppLocker publisher rule to the new signing name and version, keep the ProgramData deny rule, and verify on all affected devices", correct: true },
    { id: "f2", text: "Add a blanket allow rule for %OSDRIVE%\\PROGRAMDATA\\*" },
    { id: "f3", text: "Reinstall the application on each affected machine" },
    { id: "f4", text: "Roll every user back to version 4" },
  ],
  concept: {
    term: "Where a silent exit gets logged",
    body: "An application that appears and vanishes with no dialog has usually been stopped by something outside itself, and the giveaway is that the Application log is empty. A crash writes Event 1000 with a faulting module; a missing dependency writes an Event 1000 or a loader error; a policy block writes nothing there at all, because the process was refused before it could do anything. Application control writes to its own channel — Microsoft-Windows-AppLocker/EXE and DLL, Event 8004 for a block and 8003 for audit-only — and the same pattern holds for WDAC and for antivirus quarantine, each with its own log. The other half of this scenario is a lesson about publisher rules: they match on the exact signing subject, so a vendor renaming from 'LTD' to 'LIMITED' silently invalidates a rule that has worked for years.",
  },
  report: {
    diagnosis: "Application control policy blocking the executable after a vendor update relocated and re-signed it.",
    root: "ProjectPlanner 5.0, deployed overnight on 15 August, installs to C:\\ProgramData\\PlannerCorp rather than C:\\Program Files and is signed as 'O=PLANNERCORP LIMITED' instead of 'O=PLANNERCORP LTD'. The AppLocker policy denies %OSDRIVE%\\PROGRAMDATA\\* and its publisher allow rule no longer matched the new signing subject, so every launch was refused with STATUS_ACCESS_DENIED before the process could initialise — leaving no entry in the Application log.",
    fix: "Updated the Design publisher rule to the new signing subject and a minimum version of 5.0, retained the ProgramData deny rule, and forced a policy refresh. Confirmed the application launches and opens project files on all three affected workstations, with no further Event 8004 blocks.",
    prevent: "Test vendor updates against application control policy in a pilot ring before broad deployment, and alert on Event 8004 volume so a policy mismatch is detected by the monitoring rather than by three users raising tickets.",
  },
},
/* ------------------------------------------------------------------ 14 */
{
  id: "blue-screen",
  title: "Repeated blue screens under CAD load",
  category: "Operating System",
  difficulty: "Advanced",
  ticket: {
    num: "INC-104877",
    user: "Dr Owen Pratt",
    dept: "Research & Development",
    device: "Dell Precision 5860 — WKS-7001",
    priority: "Critical",
    opened: "14:15",
    issue: "Three bug checks today, each while using the CAD viewer",
  },
  complaint:
    "Three blue screens today. It's always when I open the CAD viewer and start rotating a model. I've lost an afternoon of work and I have a review on Tuesday. This machine has been rock solid for two years.",
  sim: {
    hostname: "WKS-7001",
    user: "CORP\\opratt",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet", desc: "Intel(R) Ethernet Controller X550",
      mac: "B4-96-91-0C-2E-14", status: "connected", dhcp: true,
      ip: "10.20.13.9", mask: "255.255.255.0", gw: "10.20.13.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
    extra: [
      ["dir c:\\windows\\minidump", ` Directory of C:\\Windows\\Minidump

16/08/2026  09:41    1,048,576  081626-14203-01.dmp
16/08/2026  11:52    1,048,576  081626-15187-01.dmp
16/08/2026  13:58    1,048,576  081626-16044-01.dmp
               3 File(s)  3,145,728 bytes`],
    ],
  },
  stages: [
    "Collect the stop code and the faulting module",
    "Establish what changed and when",
    "Test the hypothesis by removing the suspect",
    "Roll back and prove stability under load",
  ],
  actions: [
    {
      id: "a1", label: "Analyse the minidumps", cat: "System", stage: 0,
      out: `[ WinDbg — !analyze -v on 081626-16044-01.dmp ]

SYSTEM_THREAD_EXCEPTION_NOT_HANDLED (7e)
PROCESS_NAME:  CADViewer.exe
MODULE_NAME:   nvlddmkm
IMAGE_NAME:    nvlddmkm.sys
IMAGE_VERSION: 32.0.15.7283
FAILURE_BUCKET_ID: 0x7E_nvlddmkm!DriverEntry

All three dumps: same stop code, same faulting module, same version.`,
      ev: "All three dumps name nvlddmkm.sys 32.0.15.7283 (display driver) with stop code 0x7E, always under CADViewer.exe.",
      fb: "Consistency across all three dumps is the important part. One dump is an anecdote; three identical ones point at a specific binary.",
    },
    {
      id: "a2", label: "Correlate against recent changes", cat: "System", stage: 1,
      out: `[ Reliability Monitor + Update history ]

14/08 02:14  Optional driver update installed via Windows Update
             NVIDIA — Display — 32.0.15.7283
14/08        No bug checks
15/08        Machine powered off (weekend)
16/08 09:41  Bug check 0x7e
16/08 11:52  Bug check 0x7e
16/08 13:58  Bug check 0x7e

Previous driver: 31.0.15.5222 (vendor certified branch, in the
approved software baseline). Two years with no bug checks.`,
      ev: "An optional NVIDIA driver (32.0.15.7283) arrived via Windows Update on 14 Aug; the first bug check followed on the next working day. The prior driver ran two years without incident.",
      fb: "Now the dump has a story around it. 'What changed' is the question that turns a faulting module into a cause, and the timeline here is unambiguous.",
    },
    {
      id: "a3", label: "Test with the Microsoft Basic Display adapter", cat: "System", stage: 2,
      out: `[ Controlled test — vendor driver disabled, Basic Display in use ]

CADViewer opened, model rotated continuously for 40 minutes.
Result: no bug check. Rendering slow and software-only, as expected.

[ Vendor driver 32.0.15.7283 re-enabled ]
Same test: bug check 0x7e after 6 minutes.`,
      ev: "With the vendor driver disabled the workload runs 40 minutes with no bug check; re-enabling 32.0.15.7283 reproduces the crash in 6 minutes.",
      fb: "This is the difference between a strong suspicion and a proven cause — you removed one variable, the fault disappeared, you put it back and it returned.",
    },
    {
      id: "a4", label: "Roll back the driver, block the update, verify under load", cat: "System", stage: 3,
      out: `[ Remediation ]

Rolled back to 31.0.15.5222 (certified branch).
Optional driver updates blocked by policy for the workstation ring.
Bug check on the 5860 platform reported to the vendor with dump files.

Verification: 2h continuous CAD stress, four large assemblies.
Bug checks: 0.  Frame rate normal.  User returned to work 15:20.`,
      ev: "Rolled back to the certified 31.x driver; two hours of CAD stress produced no bug checks.",
      fb: "Verification proportional to the severity. A critical ticket for a machine that crashed three times deserves more than one successful launch before you close it.",
    },
    {
      id: "b1", label: "Run Windows Memory Diagnostic", cat: "System", stage: null,
      out: `[ Windows Memory Diagnostic — extended, 2 passes ]

Elapsed: 1h 48m.  Result: no memory errors detected.`,
      fb: "Not unreasonable — memory faults do cause bug checks — but three dumps naming the same module make it the wrong first move. Memory testing earns its place when the stop codes are inconsistent or the faulting module varies.",
    },
    {
      id: "b2", label: "Replace the graphics card", cat: "Hardware", stage: null,
      out: `[ Parts request — NVIDIA RTX A2000, next-day ]

Note: the dumps name a driver module, not a hardware fault. No
over-temperature, no WHEA hardware error events, no artefacts.`,
      fb: "A driver name in the dump is not a hardware fault. Swapping the card and reinstalling the same driver would reproduce the crash on new hardware.",
    },
    {
      id: "b3", label: "Reinstall Windows", cat: "System", stage: null,
      out: `[ Estimated 6h with data restore ]

Post-build, Windows Update offers the same optional driver
32.0.15.7283 within the first update cycle.`,
      fb: "Six hours to reinstall the fault. The offending driver comes back down the same channel it arrived on.",
    },
    {
      id: "b4", label: "Disable the page file to stop the crashes", cat: "System", stage: null,
      out: `[ Page file disabled ]

Bug checks continue. Minidump generation now fails — the system can no
longer write crash data, removing the evidence you were relying on.`,
      fb: "This one actively destroys your evidence: without a page file the system cannot write a dump, so the next crash tells you nothing at all.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "A faulty optional display driver installed via Windows Update is causing the bug check under GPU load", correct: true },
    { id: "d2", text: "Failing system memory" },
    { id: "d3", text: "The graphics card hardware is failing" },
    { id: "d4", text: "The CAD application is corrupt" },
    { id: "d5", text: "The system is overheating under load" },
  ],
  fixes: [
    { id: "f1", text: "Roll back to the certified driver branch, block optional driver updates for this ring, and verify with sustained CAD load", correct: true },
    { id: "f2", text: "Replace the graphics card" },
    { id: "f3", text: "Reinstall Windows and restore data" },
    { id: "f4", text: "Ask the user to avoid rotating large models" },
  ],
  concept: {
    term: "Reading a bug check",
    body: "A stop code is a category and the faulting module is the suspect; you need both. 0x7E SYSTEM_THREAD_EXCEPTION_NOT_HANDLED means a kernel thread hit an exception nobody handled, and on its own that could be almost anything — the value is in IMAGE_NAME, which names the binary executing at the time. Three dumps naming the same module and the same version, all under the same workload, is about as strong as evidence gets in this domain. Where dumps are inconsistent — different stop codes, different modules — suspect memory or storage instead, because failing hardware corrupts whatever happens to be resident rather than one specific driver. Two operational notes: minidumps live in C:\\Windows\\Minidump and need a page file to be written at all, and 'optional' driver updates from Windows Update bypass the vendor's certified branch, which is why workstation rings usually block them.",
  },
  report: {
    diagnosis: "Recurring kernel bug check caused by a defective display driver delivered as an optional update.",
    root: "NVIDIA display driver 32.0.15.7283 was installed as an optional update through Windows Update on 14 August. Under sustained 3D load from CADViewer the driver raised an unhandled exception in nvlddmkm.sys, producing stop 0x7E. All three minidumps named the same module and version, and disabling the driver eliminated the fault under a 40-minute reproduction of the same workload.",
    fix: "Rolled the display driver back to the certified branch (31.0.15.5222) that had run without incident for two years, blocked optional driver updates for the workstation ring by policy, and submitted the dump files to the vendor. Verified stability with two hours of continuous CAD load across four large assemblies with no bug checks.",
    prevent: "Exclude optional driver updates from engineering and workstation rings so graphics drivers come only from the vendor's certified branch through the managed deployment. Keep kernel dump collection enabled fleet-wide, and alert on repeat bug checks per device so a pattern is visible before a user loses an afternoon.",
  },
},
/* ------------------------------------------------------------------ 15 */
{
  id: "no-audio",
  title: "Silence after docking",
  category: "Peripherals",
  difficulty: "Beginner",
  ticket: {
    num: "INC-104889",
    user: "Grace Liu",
    dept: "Communications",
    device: "Dell Latitude 7440 + WD19 dock — LT-2755",
    priority: "Medium",
    opened: "14:50",
    issue: "No audio output since docking; headset shows powered",
  },
  complaint:
    "No sound at all since I docked this morning. My headset light is on and the mute button isn't pressed. I've got a client call in twenty minutes and I can't hear the hold music on the test line.",
  sim: {
    hostname: "LT-2755",
    user: "CORP\\gliu",
    dns: "ok",
    adapter: {
      type: "Ethernet", name: "Ethernet 2", desc: "Realtek USB GbE Family Controller (WD19)",
      mac: "8C-47-BE-31-05-D9", status: "connected", dhcp: true,
      ip: "10.20.10.104", mask: "255.255.255.0", gw: "10.20.10.1",
      dns: ["10.20.5.10", "10.20.5.11"], dhcpServer: "10.20.5.10", suffix: "corp.local",
    },
    reach: { default: true },
    resolve: { "www.google.com": "142.250.72.68" },
    dnsNames: { "10.20.5.10": "dc01.corp.local" },
  },
  stages: [
    "Check the obvious controls",
    "Read which device Windows is actually using",
    "Point output at the headset and test",
    "Set the per-application device so it holds",
  ],
  actions: [
    {
      id: "a1", label: "Check volume, mute and the app mixer", cat: "Apps", stage: 0,
      out: `[ Volume mixer — LT-2755 ]

System volume ......... 68%, not muted
Teams ................. 100%, not muted
Media player .......... 100%, not muted
Headset inline mute ... off (LED green)

Output meter for the current device shows signal activity —
so something is playing, just not where the user can hear it.`,
      ev: "Nothing is muted and the output meter shows active signal — audio is playing somewhere.",
      fb: "Ten seconds well spent. Ruling out mute is cheap, and the moving meter is the real find: the sound exists, it's going to the wrong place.",
    },
    {
      id: "a2", label: "Check the default playback device", cat: "System", stage: 1,
      out: `[ Settings > System > Sound > Output ]

Choose where to play sound:
  * DELL U2723QE (Intel(R) Display Audio)      <- default, in use
    Headset Earphone (Jabra Evolve2 65)
    Speakers (Realtek(R) Audio)

The monitor was selected as default when the dock was connected this
morning. The U2723QE has no speakers fitted.`,
      ev: "Default output is the DELL U2723QE monitor over Display Audio — a device with no speakers. The Jabra headset is present but not default.",
      fb: "There it is. Windows didn't lose the headset; it promoted a newly enumerated endpoint that happens to be silent hardware.",
    },
    {
      id: "a3", label: "Set the headset as default and test", cat: "System", stage: 2,
      out: `[ Output device set to Headset Earphone (Jabra Evolve2 65) ]

Also set as Default Communication Device.
Windows test tone .......... heard, both channels
Test line hold music ....... heard
Microphone level meter ..... responds to speech`,
      ev: "Headset set as default output and default communication device; test tone, hold music and microphone all confirmed working.",
      fb: "You set both roles, which matters — Windows keeps a separate default for communication apps, and setting only one leaves half the problem in place.",
    },
    {
      id: "a4", label: "Pin the per-application device and re-test docking", cat: "Apps", stage: 3,
      out: `[ Settings > Sound > Volume mixer > App volume and device preferences ]

Teams output ....... Headset Earphone (Jabra Evolve2 65)  (pinned)
Teams input ........ Headset Microphone (Jabra Evolve2 65)  (pinned)

Undocked and re-docked to reproduce this morning's conditions:
output device remained the headset. Teams test call: two-way audio.`,
      ev: "Per-app devices pinned for Teams; a dock/undock cycle no longer moves output to the monitor.",
      fb: "This is what stops the ticket coming back tomorrow morning. Reproducing the docking event is the only way to know the fix survives it.",
    },
    {
      id: "b1", label: "Reinstall the audio driver", cat: "System", stage: null,
      out: `[ Realtek audio driver reinstalled — 6.0.9682.1 ]

Endpoints re-enumerated. Default output after restart:
DELL U2723QE (Intel Display Audio). Still no sound in the headset.

Elapsed: 25 minutes.`,
      fb: "Twenty-five minutes to arrive back where you started, and re-enumeration can reselect the same wrong default. Device Manager showed no faults to justify it.",
    },
    {
      id: "b2", label: "Check Device Manager for audio faults", cat: "System", stage: null,
      out: `[ Device Manager — Sound, video and game controllers ]

Intel(R) Display Audio ................ working properly
Realtek(R) Audio ...................... working properly
Jabra Evolve2 65 ...................... working properly

No warning icons, no error codes.`,
      fb: "Fair to glance at, and it earns its place by ruling something out: every endpoint enumerates cleanly, so this is a selection problem rather than a device fault.",
    },
    {
      id: "b3", label: "Replace the headset", cat: "Hardware", stage: null,
      out: `[ Spare Jabra Evolve2 65 issued from stock ]

New headset enumerates and is also not the default device.
No sound. Original headset later confirmed fully working.`,
      fb: "Swapping hardware before checking the setting costs a spare from stock and proves nothing — the replacement lands in exactly the same position in the device list.",
    },
    {
      id: "b4", label: "Update the dock firmware", cat: "Hardware", stage: null,
      out: `[ WD19 firmware update — 01.00.32, 18 minutes, two reboots ]

Audio endpoints unchanged. Default output still the monitor.`,
      fb: "Eighteen minutes and two reboots, with a client call approaching. Firmware updates are for documented dock faults, not for a default-device problem.",
    },
  ],
  diagnoses: [
    { id: "d1", text: "Windows selected the monitor's Display Audio endpoint as default when the dock enumerated", correct: true },
    { id: "d2", text: "The audio driver is corrupt" },
    { id: "d3", text: "The headset has failed" },
    { id: "d4", text: "The dock needs a firmware update" },
    { id: "d5", text: "The system is muted at the hardware level" },
  ],
  fixes: [
    { id: "f1", text: "Set the headset as default output and communication device, pin it per-application, and confirm across a dock cycle", correct: true },
    { id: "f2", text: "Reinstall the Realtek audio driver" },
    { id: "f3", text: "Issue a replacement headset" },
    { id: "f4", text: "Disable Display Audio in Device Manager" },
  ],
  concept: {
    term: "Default playback device and endpoint enumeration",
    body: "Windows treats every output path as a separate endpoint — laptop speakers, headset, and each monitor that carries audio over HDMI or DisplayPort. When new endpoints appear, as they do the moment a dock connects, Windows can promote one to default, and a monitor with no speakers fitted is a perfectly valid endpoint that happens to produce silence. The symptom is distinctive: nothing is muted, the output meter moves, and the user hears nothing. Two details are worth carrying: Windows keeps a separate Default Communication Device used by Teams and softphones, so setting only the general default leaves calls broken; and per-application device preferences survive re-enumeration, which is what stops the problem returning at the next dock.",
  },
  report: {
    diagnosis: "Audio routed to a silent endpoint after dock connection, not an audio hardware or driver fault.",
    root: "Connecting the WD19 dock enumerated the DELL U2723QE monitor's Intel Display Audio endpoint, and Windows selected it as the default output device. The monitor has no speakers fitted, so all audio was rendered to an endpoint that produces no sound while the Jabra headset remained present, healthy and unselected.",
    fix: "Set the Jabra Evolve2 65 as both the default output device and the default communication device, confirmed a test tone, hold music and microphone activity, then pinned the headset for Teams under app volume and device preferences. Verified through an undock and re-dock cycle and a two-way Teams test call.",
    prevent: "Include per-application audio pinning in the docking-station setup checklist, and give users the one-line self-service check — Sound settings, confirm the output device — since this recurs whenever a new monitor or dock is introduced.",
  },
},
];

/* ============================================================ scoring model */
const WEIGHTS = { accuracy: 35, efficiency: 25, diagnosis: 25, fix: 15 };

function scoreRun(scn, steps, dxOk, fixOk) {
  const counted = steps.filter((s) => s.verdict !== "repeat");
  const onPath = counted.filter((s) => s.verdict === "onpath").length;
  const optimal = scn.stages.length;
  const accuracy = counted.length ? onPath / counted.length : 0;
  const efficiency = counted.length ? Math.min(1, optimal / Math.max(counted.length, optimal)) : 0;
  const parts = {
    accuracy: Math.round(accuracy * WEIGHTS.accuracy),
    efficiency: Math.round(efficiency * WEIGHTS.efficiency),
    diagnosis: dxOk ? WEIGHTS.diagnosis : 0,
    fix: fixOk ? WEIGHTS.fix : 0,
  };
  const total = parts.accuracy + parts.efficiency + parts.diagnosis + parts.fix;
  const grade = total >= 90 ? "A" : total >= 80 ? "B" : total >= 68 ? "C" : total >= 55 ? "D" : "E";
  return { parts, total, grade, onPath, counted: counted.length, optimal, accuracy, efficiency };
}

const DIFF_STYLE = {
  Beginner: "text-emerald-300 border-emerald-800 bg-emerald-950",
  Intermediate: "text-amber-300 border-amber-800 bg-amber-950",
  Advanced: "text-rose-300 border-rose-800 bg-rose-950",
};
const PRIORITY_STYLE = {
  Critical: "text-rose-300 bg-rose-950 border-rose-800",
  High: "text-orange-300 bg-orange-950 border-orange-900",
  Medium: "text-amber-300 bg-amber-950 border-amber-900",
  Low: "text-zinc-300 bg-zinc-900 border-zinc-700",
};

/* ================================================================ fragments */
function Eyebrow({ children, tone = "zinc" }) {
  const tones = { zinc: "text-zinc-500", amber: "text-amber-500", cyan: "text-cyan-500" };
  return (
    <div className={`font-mono text-[10px] uppercase tracking-[0.18em] ${tones[tone]}`}>{children}</div>
  );
}

function Panel({ label, right, children, className = "" }) {
  return (
    <section className={`border border-zinc-800 bg-zinc-900 ${className}`}>
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <Eyebrow>{label}</Eyebrow>
        {right}
      </header>
      {children}
    </section>
  );
}

/* ===================================================================== HOME */
function Home({ onStart, onArch, results }) {
  const done = Object.keys(results).length;
  const avg = done
    ? Math.round(Object.values(results).reduce((a, r) => a + r.total, 0) / done)
    : 0;
  const groups = ["Beginner", "Intermediate", "Advanced"];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="border-b border-zinc-800 pb-8">
        <Eyebrow tone="amber">Desktop support training environment</Eyebrow>
        <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          IT Troubleshooting Lab
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Fifteen tickets from a working service desk. Each one opens with what the user said, not
          with what is wrong. Work the evidence with a simulated console, decide what to do next, and
          close with a diagnosis you can defend. Wrong turns are allowed — they answer back.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-6 font-mono text-xs text-zinc-500">
          <span>
            <span className="text-zinc-200">{SCENARIOS.length}</span> scenarios
          </span>
          <span>
            <span className="text-zinc-200">{done}</span> closed
          </span>
          {done > 0 && (
            <span>
              average <span className="text-amber-300">{avg}</span>/100
            </span>
          )}
          <button onClick={onArch} className="text-cyan-400 underline underline-offset-4 hover:text-cyan-300">
            How the decision engine works
          </button>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g} className="mt-10">
          <div className="mb-3 flex items-baseline gap-3">
            <Eyebrow>{g}</Eyebrow>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SCENARIOS.filter((s) => s.difficulty === g).map((s) => {
              const r = results[s.id];
              return (
                <button
                  key={s.id}
                  onClick={() => onStart(s.id)}
                  className="group flex flex-col border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-amber-700 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] tracking-wider text-zinc-500">
                    <span>{s.ticket.num}</span>
                    <span>{s.category}</span>
                  </div>
                  <div className="mt-2 text-sm font-medium text-zinc-100">{s.title}</div>
                  <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-zinc-500">
                    “{s.complaint.slice(0, 110)}…”
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-zinc-600">
                      {s.stages.length} steps on the optimal path
                    </span>
                    {r ? (
                      <span className="font-mono text-[11px] text-amber-300">
                        {r.grade} · {r.total}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] text-zinc-600 group-hover:text-amber-400">open →</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================== TICKET CARD */
function TicketPanel({ scn, elapsed }) {
  const t = scn.ticket;
  const rows = [
    ["User", t.user],
    ["Department", t.dept],
    ["Device", t.device],
    ["Opened", t.opened],
    ["Elapsed", `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`],
  ];
  return (
    <Panel
      label={t.num}
      right={
        <span className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${PRIORITY_STYLE[t.priority]}`}>
          {t.priority}
        </span>
      }
    >
      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="text-sm font-medium text-zinc-100">{t.issue}</div>
      </div>
      <dl className="divide-y divide-zinc-800 border-b border-zinc-800">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-3 py-1.5">
            <dt className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">{k}</dt>
            <dd className="font-mono text-[11px] text-zinc-300">{v}</dd>
          </div>
        ))}
      </dl>
      <blockquote className="px-3 py-3">
        <Eyebrow>Reported by the user</Eyebrow>
        <p className="mt-2 border-l-2 border-amber-700 pl-3 text-sm italic leading-relaxed text-zinc-300">
          {scn.complaint}
        </p>
      </blockquote>
    </Panel>
  );
}

/* ================================================================= TERMINAL */
const LINE_STYLE = {
  cmd: "text-amber-300",
  out: "text-cyan-200",
  sys: "text-zinc-400",
  good: "text-emerald-300",
  bad: "text-rose-300",
  warn: "text-orange-300",
};

function Terminal({ log, onRun, hostname, user }) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState([]);
  const [hIndex, setHIndex] = useState(-1);
  const endRef = useRef(null);
  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ block: "end" });
  }, [log]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    setHistory((h) => [v, ...h]);
    setHIndex(-1);
    onRun(v);
    setValue("");
  };

  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(hIndex + 1, history.length - 1);
      if (i >= 0) { setHIndex(i); setValue(history[i]); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = hIndex - 1;
      setHIndex(i);
      setValue(i >= 0 ? history[i] : "");
    }
  };

  return (
    <Panel
      label="Console — simulated"
      className="flex min-h-0 flex-1 flex-col"
      right={<span className="font-mono text-[10px] text-zinc-600">{hostname}</span>}
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-black px-3 py-3">
        {log.map((l, i) => (
          <pre
            key={i}
            className={`whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${LINE_STYLE[l.kind]} ${
              l.kind === "cmd" ? "mt-3" : ""
            }`}
          >
            {l.kind === "cmd" ? `C:\\> ${l.text}` : l.text}
          </pre>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-zinc-800 bg-black px-3 py-2">
        <span className="font-mono text-[11px] text-amber-400">C:\&gt;</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
          placeholder="type a command, or `help`"
          aria-label="Simulated command input"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-cyan-200 placeholder-zinc-700 outline-none"
        />
        <button
          onClick={submit}
          className="border border-zinc-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 hover:border-amber-600 hover:text-amber-300"
        >
          Run
        </button>
      </div>
    </Panel>
  );
}

/* ============================================================ ACTION BUTTON */
const CAT_TONE = {
  Console: "text-cyan-400",
  System: "text-violet-300",
  Hardware: "text-orange-300",
  Network: "text-sky-300",
  Apps: "text-teal-300",
  User: "text-pink-300",
  Server: "text-amber-300",
  Escalation: "text-zinc-400",
};

function ActionButton({ a, state, onClick }) {
  const used = !!state;
  const tone =
    state === "onpath" ? "border-emerald-800 bg-emerald-950" :
    state === "premature" ? "border-orange-900 bg-orange-950" :
    state === "wrong" ? "border-rose-900 bg-rose-950" :
    "border-zinc-800 bg-zinc-900 hover:border-amber-700 hover:bg-zinc-800";
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-2 border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${tone}`}
    >
      <span className={`mt-0.5 font-mono text-[10px] ${used ? "text-zinc-500" : CAT_TONE[a.cat] || "text-zinc-500"}`}>
        {used ? (state === "onpath" ? "✓" : "×") : "▸"}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-snug ${used ? "text-zinc-400" : "text-zinc-100"}`}>{a.label}</span>
        <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-wider text-zinc-600">{a.cat}</span>
      </span>
    </button>
  );
}

/* ====================================================================== LAB */
function Lab({ scn, onFinish, onQuit }) {
  const [log, setLog] = useState([
    { kind: "sys", text: `Simulated session on ${scn.sim.hostname}. Nothing here runs on a real host.\nType \`help\` for the command list, or pick an action from the investigation panel.` },
  ]);
  const [steps, setSteps] = useState([]);
  const [stage, setStage] = useState(0);
  const [evidence, setEvidence] = useState([]);
  const [notes, setNotes] = useState("");
  const [patch, setPatch] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [dx, setDx] = useState(null);
  const [fix, setFix] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const sim = useMemo(() => (patch ? { ...scn.sim, ...patch } : scn.sim), [scn, patch]);
  const stateOf = (id) => {
    const s = steps.find((x) => x.id === id);
    return s ? s.verdict : null;
  };

  const push = (entries) => setLog((l) => [...l, ...entries]);

  const advance = (takenIds) => {
    setStage((cur) => {
      let n = cur + 1;
      while (scn.actions.some((a) => a.stage === n && takenIds.includes(a.id))) n += 1;
      return n;
    });
  };

  const perform = (a, viaCommand) => {
    const prior = stateOf(a.id);
    if (prior) {
      push([{ kind: "warn", text: `[ ${a.label} — already performed. Repeating a step you have already run does not add evidence. ]` }]);
      setSteps((s) => [...s, { id: a.id, label: a.label, verdict: "repeat", at: elapsed }]);
      setFeedback({ kind: "repeat", text: "You already have this result. Re-running it costs time without adding evidence." });
      return;
    }
    let verdict;
    if (a.stage === null || a.stage === undefined) verdict = "wrong";
    else if (a.stage === stage) verdict = "onpath";
    else if (a.stage > stage) verdict = "premature";
    else verdict = "wrong";

    const body = a.cmd && !a.out ? runCommand(a.simOverride ? { ...sim, ...a.simOverride } : sim, a.cmd) : a.out;
    const lines = [];
    if (a.cmd) lines.push({ kind: "cmd", text: a.cmd });
    else lines.push({ kind: "cmd", text: `action: ${a.label.toLowerCase()}` });
    if (body) lines.push({ kind: "out", text: body });
    if (verdict === "onpath") lines.push({ kind: "good", text: `[ on path — step ${a.stage + 1} of ${scn.stages.length}: ${scn.stages[a.stage]} ]` });
    if (verdict === "premature") lines.push({ kind: "warn", text: `[ out of sequence — this belongs at step ${a.stage + 1}; you have not finished step ${stage + 1} yet ]` });
    if (verdict === "wrong") lines.push({ kind: "bad", text: `[ off path ]` });
    push(lines);

    if (a.simOverride) setPatch((p) => ({ ...(p || {}), ...a.simOverride }));
    if (a.ev) setEvidence((e) => [...e, { text: a.ev, from: a.label, at: elapsed, verdict }]);

    const nextSteps = [...steps, { id: a.id, label: a.label, verdict, at: elapsed, cmd: a.cmd || null }];
    setSteps(nextSteps);
    if (verdict === "onpath") advance(nextSteps.map((s) => s.id));

    setFeedback({
      kind: verdict,
      text:
        verdict === "onpath"
          ? a.fb
          : verdict === "premature"
          ? `${a.fb || "This is a real step in this investigation."} Running it now means acting before the evidence supports it — sequence is part of the diagnosis.`
          : a.fb,
      via: viaCommand,
    });
  };

  const runTyped = (raw) => {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const match = scn.actions.find((a) => a.cmd && norm(a.cmd) === norm(raw) && !stateOf(a.id));
    if (match) { perform(match, true); return; }
    const out = runCommand(sim, raw);
    if (out === "__CLEAR__") { setLog([]); return; }
    push([{ kind: "cmd", text: raw }, { kind: "out", text: out }]);
  };

  const finish = () => {
    const dxOk = !!(dx && scn.diagnoses.find((d) => d.id === dx)?.correct);
    const fixOk = !!(fix && scn.fixes.find((f) => f.id === fix)?.correct);
    onFinish({
      scenarioId: scn.id,
      steps,
      evidence,
      notes,
      dx,
      fix,
      dxOk,
      fixOk,
      elapsed,
      result: scoreRun(scn, steps, dxOk, fixOk),
    });
  };

  const live = scoreRun(scn, steps, false, false);
  const grouped = useMemo(() => {
    const map = {};
    scn.actions.forEach((a) => {
      (map[a.cat] = map[a.cat] || []).push(a);
    });
    return map;
  }, [scn]);

  return (
    <div className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5">
      {/* command bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="flex items-center gap-3">
          <button onClick={onQuit} className="font-mono text-[11px] text-zinc-500 hover:text-amber-300">
            ← queue
          </button>
          <span className="hidden h-4 w-px bg-zinc-800 sm:block" />
          <span className="text-sm text-zinc-100">{scn.title}</span>
          <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${DIFF_STYLE[scn.difficulty]}`}>
            {scn.difficulty}
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="flex items-center gap-1.5" title="Progress along the optimal path">
            {scn.stages.map((s, i) => (
              <span
                key={i}
                title={s}
                className={`h-1.5 w-6 ${i < stage ? "bg-emerald-500" : "bg-zinc-700"}`}
              />
            ))}
            <span className="ml-1 text-zinc-500">
              {Math.min(stage, scn.stages.length)}/{scn.stages.length}
            </span>
          </span>
          <span className="text-zinc-500">
            steps <span className="text-zinc-200">{live.counted}</span>
          </span>
          <span className="text-zinc-500">
            on path <span className="text-emerald-300">{live.onPath}</span>
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* left rail */}
        <div className="space-y-4 lg:col-span-3">
          <TicketPanel scn={scn} elapsed={elapsed} />
          <Panel label={`Evidence — ${evidence.length} finding${evidence.length === 1 ? "" : "s"}`}>
            {evidence.length === 0 ? (
              <p className="px-3 py-4 text-xs leading-relaxed text-zinc-500">
                Findings you establish will collect here. Each one is stamped with the step that produced
                it, and the list becomes the audit trail on your final report.
              </p>
            ) : (
              <ol className="divide-y divide-zinc-800">
                {evidence.map((e, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-zinc-600">
                        {String(Math.floor(e.at / 60)).padStart(2, "0")}:{String(e.at % 60).padStart(2, "0")}
                      </span>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.verdict === "onpath" ? "bg-emerald-500" : "bg-orange-500"}`} />
                      <span className="text-xs leading-relaxed text-zinc-300">{e.text}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* console column */}
        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className="flex h-[520px] flex-col">
            <Terminal log={log} onRun={runTyped} hostname={scn.sim.hostname} user={scn.sim.user} />
          </div>
          <Panel label="Technician notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What you observed, what you ruled out, and why. These notes are carried into the final report."
              className="h-28 w-full resize-y bg-zinc-900 px-3 py-2 text-xs leading-relaxed text-zinc-200 placeholder-zinc-600 outline-none"
            />
            <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-1.5">
              <span className="font-mono text-[10px] text-zinc-600">{notes.length} characters</span>
              <button
                onClick={() =>
                  setNotes((n) => `${n}${n && !n.endsWith("\n") ? "\n" : ""}[${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}] `)
                }
                className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-amber-300"
              >
                + timestamp
              </button>
            </div>
          </Panel>
        </div>

        {/* investigation column */}
        <div className="space-y-4 lg:col-span-4">
          <Panel label="Investigation">
            <div className="max-h-[420px] space-y-3 overflow-y-auto p-3">
              {Object.entries(grouped).map(([cat, list]) => (
                <div key={cat}>
                  <Eyebrow>{cat}</Eyebrow>
                  <div className="mt-1.5 space-y-1.5">
                    {list.map((a) => (
                      <ActionButton key={a.id} a={a} state={stateOf(a.id)} onClick={() => perform(a, false)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {feedback && (
            <div
              className={`border p-3 ${
                feedback.kind === "onpath"
                  ? "border-emerald-800 bg-emerald-950"
                  : feedback.kind === "premature"
                  ? "border-orange-900 bg-orange-950"
                  : feedback.kind === "repeat"
                  ? "border-zinc-700 bg-zinc-900"
                  : "border-rose-900 bg-rose-950"
              }`}
            >
              <Eyebrow>
                {feedback.kind === "onpath"
                  ? "Good next step"
                  : feedback.kind === "premature"
                  ? "Right step, wrong moment"
                  : feedback.kind === "repeat"
                  ? "Already done"
                  : "Not the best next step"}
              </Eyebrow>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-200">{feedback.text}</p>
            </div>
          )}

          <Panel label="Decision">
            {!deciding ? (
              <div className="space-y-3 p-3">
                <p className="text-xs leading-relaxed text-zinc-400">
                  Close the ticket when the evidence supports a call. You can decide at any point — an
                  early guess scores the same way a late one does, minus the evidence to back it.
                </p>
                <button
                  onClick={() => setDeciding(true)}
                  className="w-full border border-amber-700 bg-amber-950 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-amber-200 hover:bg-amber-900"
                >
                  Submit diagnosis
                </button>
              </div>
            ) : (
              <div className="space-y-4 p-3">
                <div>
                  <Eyebrow tone="amber">What is wrong</Eyebrow>
                  <div className="mt-2 space-y-1.5">
                    {scn.diagnoses.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setDx(d.id)}
                        className={`block w-full border px-3 py-2 text-left text-xs leading-relaxed ${
                          dx === d.id ? "border-amber-600 bg-amber-950 text-amber-100" : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        {d.text}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Eyebrow tone="amber">What you will do about it</Eyebrow>
                  <div className="mt-2 space-y-1.5">
                    {scn.fixes.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFix(f.id)}
                        className={`block w-full border px-3 py-2 text-left text-xs leading-relaxed ${
                          fix === f.id ? "border-amber-600 bg-amber-950 text-amber-100" : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                        }`}
                      >
                        {f.text}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeciding(false)}
                    className="border border-zinc-700 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-200"
                  >
                    Back
                  </button>
                  <button
                    disabled={!dx || !fix}
                    onClick={finish}
                    className="flex-1 border border-amber-700 bg-amber-950 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-amber-200 hover:bg-amber-900 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900 disabled:text-zinc-600"
                  >
                    Close ticket
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== REPORT */
function buildSummary(scn, run) {
  const t = scn.ticket;
  const mm = `${Math.floor(run.elapsed / 60)}m ${run.elapsed % 60}s`;
  const lines = [];
  lines.push(`TICKET ${t.num} — ${t.issue}`);
  lines.push(`${t.user}, ${t.dept} — ${t.device}`);
  lines.push(`Opened ${t.opened} · handled in ${mm} · ${run.steps.length} action${run.steps.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push("STEPS TAKEN");
  run.steps.forEach((s, i) => {
    const tag = s.verdict === "onpath" ? "on path" : s.verdict === "premature" ? "out of sequence" : s.verdict === "repeat" ? "repeated" : "off path";
    lines.push(`${String(i + 1).padStart(2, "0")}. ${s.label} — ${tag}`);
  });
  lines.push("");
  lines.push("EVIDENCE ESTABLISHED");
  if (run.evidence.length === 0) lines.push("(none recorded)");
  run.evidence.forEach((e) => lines.push(`- ${e.text}`));
  lines.push("");
  lines.push(`DIAGNOSIS SUBMITTED: ${scn.diagnoses.find((d) => d.id === run.dx)?.text || "-"} [${run.dxOk ? "correct" : "incorrect"}]`);
  lines.push(`ACTION SUBMITTED:    ${scn.fixes.find((f) => f.id === run.fix)?.text || "-"} [${run.fixOk ? "correct" : "incorrect"}]`);
  lines.push("");
  lines.push("ROOT CAUSE");
  lines.push(scn.report.root);
  lines.push("");
  lines.push("RESOLUTION");
  lines.push(scn.report.fix);
  lines.push("");
  lines.push("PREVENTIVE RECOMMENDATION");
  lines.push(scn.report.prevent);
  if (run.notes.trim()) {
    lines.push("");
    lines.push("TECHNICIAN NOTES");
    lines.push(run.notes.trim());
  }
  lines.push("");
  lines.push(`SCORE ${run.result.total}/100 (${run.result.grade}) — accuracy ${run.result.parts.accuracy}/${WEIGHTS.accuracy}, efficiency ${run.result.parts.efficiency}/${WEIGHTS.efficiency}, diagnosis ${run.result.parts.diagnosis}/${WEIGHTS.diagnosis}, action ${run.result.parts.fix}/${WEIGHTS.fix}`);
  return lines.join("\n");
}

function Bar({ label, value, max }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300">
          {value}/{max}
        </span>
      </div>
      <div className="mt-1 h-1.5 bg-zinc-800">
        <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Report({ scn, run, onRetry, onQuit }) {
  const [copied, setCopied] = useState(false);
  const summary = useMemo(() => buildSummary(scn, run), [scn, run]);
  const r = run.result;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const verdictLabel = { onpath: "on path", premature: "out of sequence", wrong: "off path", repeat: "repeated" };
  const verdictTone = {
    onpath: "text-emerald-400",
    premature: "text-orange-400",
    wrong: "text-rose-400",
    repeat: "text-zinc-500",
  };
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <button onClick={onQuit} className="font-mono text-[11px] text-zinc-500 hover:text-amber-300">
        ← queue
      </button>

      <div className="mt-4 flex flex-col gap-6 border-b border-zinc-800 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow tone="amber">Closure report · {scn.ticket.num}</Eyebrow>
          <h1 className="mt-2 font-mono text-2xl font-semibold text-zinc-50 sm:text-3xl">{scn.title}</h1>
          <p className="mt-2 font-mono text-[11px] text-zinc-500">
            {run.steps.length} actions · {r.onPath} on path · {Math.floor(run.elapsed / 60)}m {run.elapsed % 60}s ·
            optimal path {r.optimal} steps
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-5xl font-semibold text-amber-300">{r.total}</div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">grade {r.grade}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Bar label="Accuracy" value={r.parts.accuracy} max={WEIGHTS.accuracy} />
        <Bar label="Efficiency" value={r.parts.efficiency} max={WEIGHTS.efficiency} />
        <Bar label="Diagnosis" value={r.parts.diagnosis} max={WEIGHTS.diagnosis} />
        <Bar label="Action" value={r.parts.fix} max={WEIGHTS.fix} />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className={`border p-4 ${run.dxOk ? "border-emerald-800 bg-emerald-950" : "border-rose-900 bg-rose-950"}`}>
          <Eyebrow>Your diagnosis — {run.dxOk ? "correct" : "incorrect"}</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-zinc-100">
            {scn.diagnoses.find((d) => d.id === run.dx)?.text}
          </p>
          {!run.dxOk && (
            <p className="mt-3 border-t border-rose-900 pt-3 text-sm leading-relaxed text-zinc-300">
              The supported call was: {scn.diagnoses.find((d) => d.correct).text}.
            </p>
          )}
        </div>
        <div className={`border p-4 ${run.fixOk ? "border-emerald-800 bg-emerald-950" : "border-rose-900 bg-rose-950"}`}>
          <Eyebrow>Your action — {run.fixOk ? "correct" : "incorrect"}</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-zinc-100">
            {scn.fixes.find((f) => f.id === run.fix)?.text}
          </p>
          {!run.fixOk && (
            <p className="mt-3 border-t border-rose-900 pt-3 text-sm leading-relaxed text-zinc-300">
              The supported action was: {scn.fixes.find((f) => f.correct).text}.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {[
            ["Diagnosis", scn.report.diagnosis],
            ["Root cause", scn.report.root],
            ["Recommended fix", scn.report.fix],
            ["Preventive recommendation", scn.report.prevent],
          ].map(([k, v]) => (
            <div key={k}>
              <Eyebrow tone="amber">{k}</Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-zinc-300">{v}</p>
            </div>
          ))}

          <div className="border border-cyan-900 bg-zinc-900 p-4">
            <Eyebrow tone="cyan">Concept — {scn.concept.term}</Eyebrow>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">{scn.concept.body}</p>
          </div>

          {run.notes.trim() && (
            <div>
              <Eyebrow>Technician notes</Eyebrow>
              <pre className="mt-2 whitespace-pre-wrap border-l-2 border-zinc-700 pl-3 font-sans text-sm leading-relaxed text-zinc-300">
                {run.notes.trim()}
              </pre>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <Eyebrow>Steps taken</Eyebrow>
            <ol className="mt-2 divide-y divide-zinc-800 border border-zinc-800">
              {run.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 px-3 py-2">
                  <span className="font-mono text-[10px] text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs leading-snug text-zinc-300">{s.label}</span>
                    <span className={`font-mono text-[10px] uppercase tracking-wider ${verdictTone[s.verdict]}`}>
                      {verdictLabel[s.verdict]}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <Eyebrow>Optimal path</Eyebrow>
            <ol className="mt-2 space-y-1">
              {scn.stages.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-zinc-400">
                  <span className="font-mono text-[10px] text-emerald-600">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="mt-10 border border-zinc-800 bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <Eyebrow>Generated summary</Eyebrow>
          <button onClick={copy} className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 hover:text-amber-300">
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap bg-black px-3 py-3 font-mono text-[11px] leading-relaxed text-cyan-200">
          {summary}
        </pre>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={onRetry}
          className="border border-amber-700 bg-amber-950 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-amber-200 hover:bg-amber-900"
        >
          Run this ticket again
        </button>
        <button
          onClick={onQuit}
          className="border border-zinc-700 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400 hover:text-zinc-100"
        >
          Back to the queue
        </button>
      </div>
    </div>
  );
}

/* ============================================================= ARCHITECTURE */
function Code({ children }) {
  return (
    <pre className="overflow-x-auto border border-zinc-800 bg-black px-3 py-3 font-mono text-[11px] leading-relaxed text-cyan-200">
      {children}
    </pre>
  );
}

function Architecture({ onBack }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <button onClick={onBack} className="font-mono text-[11px] text-zinc-500 hover:text-amber-300">
        ← queue
      </button>
      <Eyebrow tone="amber">Design notes</Eyebrow>
      <h1 className="mt-2 font-mono text-3xl font-semibold text-zinc-50">How the decision engine works</h1>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        The interesting problem in a troubleshooting simulator is not rendering a terminal — it is
        judging a step. A technician can take the right action at the wrong moment, or reach the right
        answer by a route that would not survive a change advisory board. The engine below scores the
        route, not just the destination.
      </p>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">1. Scenarios are data, not code</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Every scenario is a plain object. Adding a sixteenth ticket means adding a record — no new
        components, no new branching logic. Each action carries the stage it belongs to, the output it
        produces, the finding it establishes, and the coaching line shown when it is chosen.
      </p>
      <Code>{`{
  id, title, difficulty, category,
  ticket:  { num, user, dept, device, priority, opened, issue },
  complaint: "what the user actually said",
  sim:     { hostname, user, adapter, reach, resolve, dns, extra },
  stages:  ["Establish the interface state", "Inspect the physical path", ...],
  actions: [
    { id, label, cat, stage: 0,     cmd, out, ev, fb },   // on the path
    { id, label, cat, stage: null,  out, fb }             // a defensible wrong turn
  ],
  diagnoses: [{ id, text, correct }],
  fixes:     [{ id, text, correct }],
  concept:   { term, body },
  report:    { diagnosis, root, fix, prevent }
}`}</Code>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">2. The tree is a stage cursor</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        A literal node-and-edge tree makes authoring painful and produces dead ends. Instead the
        session holds a cursor over an ordered list of stages, and every action is judged against it.
        The result is the same branching behaviour with a fraction of the authoring cost, and it
        yields a fourth verdict a classic tree cannot express: <span className="text-orange-300">right
        step, wrong moment</span>.
      </p>
      <Code>{`action.stage === null        -> off path        (why this is not the next step)
action.stage === cursor      -> on path         (cursor advances)
action.stage >  cursor        -> out of sequence (output shown, no advance)
action.stage <  cursor        -> superseded      (evidence already in hand)
already performed             -> repeated        (costs time, adds nothing)

on advance: skip any stage whose action was already run out of sequence`}</Code>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Out-of-sequence actions still print their real output. Hiding it would teach the wrong lesson —
        in practice you can run any command you like; what you cannot do is claim the conclusion before
        the evidence supports it. The penalty is in the score, not in a locked button.
      </p>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">3. The console is a state machine over a machine profile</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Commands are never executed. Each scenario ships a <span className="font-mono text-cyan-300">sim</span> profile
        describing one workstation — adapter state, reachability map, resolver behaviour, name table —
        and a single interpreter renders authentic output from it. That is why the seven core commands
        stay consistent with each other: a machine holding an APIPA address reports it in{" "}
        <span className="font-mono text-cyan-300">ipconfig</span>, fails{" "}
        <span className="font-mono text-cyan-300">tracert</span>, and returns destination-host-unreachable
        from <span className="font-mono text-cyan-300">ping</span>, because all three read the same state.
      </p>
      <Code>{`sim.adapter.status  = "disconnected"  -> ipconfig prints Media disconnected
sim.adapter.apipa   = true           -> ping returns Destination host unreachable
sim.dns             = "fail"         -> ping by name fails, ping by IP succeeds
sim.reach["8.8.8.8"]= true           -> routing proven while resolution is broken
sim.extra           = [[match, out]] -> per-scenario commands (net use, klist, cmdkey)

Free-typed commands are matched against the action list: type the command an
action would run and it counts as taking that action.`}</Code>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">4. Scoring</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Four independent components, all visible to the learner. Accuracy asks whether your steps
        belonged; efficiency asks whether there were too many of them; the last two ask whether you
        landed the call and the remediation. Repeated steps are excluded from accuracy but still count
        against efficiency, which is exactly how a real handling time behaves.
      </p>
      <Code>{`accuracy   = on-path steps / counted steps          -> 35 points
efficiency = optimal steps / max(counted, optimal)   -> 25 points
diagnosis  = correct root cause selected             -> 25 points
action     = correct remediation selected            -> 15 points
                                                        ---
                                                        100`}</Code>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">5. Where the pieces run</h2>
      <Code>{`  ┌──────────────────────────────────────────────────────────────┐
  │ React + TypeScript client                                     │
  │                                                               │
  │  ticket rail   console        investigation    decision       │
  │  evidence      (simulator)    (action list)    (dx + fix)     │
  │        │            │               │              │          │
  │        └────────────┴──── session reducer ─────────┘          │
  │                            │                                  │
  │                    scenario catalogue (versioned with build)  │
  └────────────────────────────┼──────────────────────────────────┘
                               │  JSON over HTTP
  ┌────────────────────────────┼──────────────────────────────────┐
  │ FastAPI (Python)           ▼                                  │
  │  POST /api/sessions              open a run                   │
  │  POST /api/sessions/{id}/steps   record + independently judge  │
  │  POST /api/sessions/{id}/close   diagnosis, fix, final score   │
  │  GET  /api/sessions/{id}/report  closure report               │
  │  GET  /api/stats/scenarios       where learners go wrong      │
  │                            │                                  │
  │  SQLite: scenarios · sessions · session_steps · notes         │
  └───────────────────────────────────────────────────────────────┘`}</Code>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        Scenario content is versioned with the client build rather than stored as rows, because it is
        authored prose that belongs under code review. The API owns what the client should not be
        trusted with: it re-judges every submitted step against its own copy of the stage table, so the
        recorded score is server-computed. That split also gives the analytics endpoint something
        worth reading — which step learners most often skip, and which wrong turn each scenario
        attracts.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        This demo runs entirely in the browser with the same engine and the same catalogue, so the
        public deployment needs no server, no database and no API keys. The FastAPI service adds
        persistence, cohort reporting and server-side verification when the lab is hosted for a team.
      </p>

      <h2 className="mt-10 border-b border-zinc-800 pb-2 font-mono text-lg text-zinc-100">6. Design decisions worth defending</h2>
      <ul className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-400">
        <li>
          <span className="text-zinc-200">Wrong turns are written, not generated.</span> Every incorrect
          action has a real consequence and a specific explanation — reinstalling into the same blocked
          path, resetting a password that the phone will invalidate again in twenty minutes. A generic
          “that is incorrect” teaches nothing.
        </li>
        <li>
          <span className="text-zinc-200">Some wrong turns are nearly right.</span> Pinging the printer,
          checking Device Manager, running a memory test — these are defensible steps that cost time. The
          feedback says so rather than pretending they are foolish, because that is the actual judgement
          being trained.
        </li>
        <li>
          <span className="text-zinc-200">The user's words come first.</span> Each ticket opens with a
          complaint, not a symptom. Translating “it says connected but nothing loads” into “name
          resolution is failing” is the skill being practised.
        </li>
        <li>
          <span className="text-zinc-200">Nothing is executed.</span> No shell, no subprocess, no
          network calls. The console is a pure function of scenario state, which is what makes it safe
          to expose publicly and deterministic enough to assess.
        </li>
      </ul>
    </div>
  );
}

/* ==================================================================== ROOT */
export default function App() {
  const [view, setView] = useState("home");
  const [current, setCurrent] = useState(null);
  const [run, setRun] = useState(null);
  const [results, setResults] = useState({});
  const [runKey, setRunKey] = useState(0);

  const scn = SCENARIOS.find((s) => s.id === current);

  const start = (id) => {
    setCurrent(id);
    setRun(null);
    setRunKey((k) => k + 1);
    setView("lab");
    window.scrollTo(0, 0);
  };
  const finish = (payload) => {
    setRun(payload);
    setResults((r) => ({ ...r, [payload.scenarioId]: payload.result }));
    setView("report");
    window.scrollTo(0, 0);
  };
  const quit = () => {
    setView("home");
    window.scrollTo(0, 0);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 antialiased">
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-2.5 sm:px-5">
          <button onClick={quit} className="flex items-center gap-2 focus:outline-none">
            <span className="h-2 w-2 bg-amber-400" />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-300">
              IT Troubleshooting Lab
            </span>
          </button>
          <nav className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.15em]">
            <button onClick={quit} className={view === "home" ? "text-amber-300" : "text-zinc-500 hover:text-zinc-200"}>
              Queue
            </button>
            <button
              onClick={() => { setView("arch"); window.scrollTo(0, 0); }}
              className={view === "arch" ? "text-amber-300" : "text-zinc-500 hover:text-zinc-200"}
            >
              Architecture
            </button>
          </nav>
        </div>
      </header>

      {view === "home" && <Home onStart={start} onArch={() => { setView("arch"); window.scrollTo(0, 0); }} results={results} />}
      {view === "lab" && scn && <Lab key={runKey} scn={scn} onFinish={finish} onQuit={quit} />}
      {view === "report" && scn && run && (
        <Report scn={scn} run={run} onRetry={() => start(scn.id)} onQuit={quit} />
      )}
      {view === "arch" && <Architecture onBack={quit} />}

      <footer className="border-t border-zinc-800 px-4 py-6 sm:px-5">
        <p className="mx-auto max-w-[1500px] font-mono text-[10px] leading-relaxed text-zinc-600">
          Training simulation. Every command output is generated from scenario data — no commands are
          executed and no host is contacted. Tickets, users and infrastructure are fictional.
        </p>
      </footer>
    </div>
  );
}
