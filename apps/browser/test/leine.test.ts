import { describe, expect, it } from 'vitest';
import { anfragePruefen, hostErlaubt, nurLesend } from '../src/leine.js';

const H = ['jku.at'];
const p = (methode: string, url: string, daten: string | null = null, anmeldung = false, navigation = true) => anfragePruefen({ methode, url, daten, anmeldung, navigation }, H);

describe('Leine des Moodle-Browsers', () => {
  it('nur erlaubte Domains (exakt oder Unterdomain), nur http(s)', () => {
    expect(hostErlaubt('https://moodle.jku.at/course/view.php?id=1', H)).toBe(true);
    expect(hostErlaubt('https://jku.at/', H)).toBe(true);
    expect(hostErlaubt('https://evil-jku.at/', H)).toBe(false);
    expect(hostErlaubt('https://jku.at.evil.com/', H)).toBe(false);
    expect(hostErlaubt('https://login.microsoftonline.com/', H)).toBe(false);
    expect(hostErlaubt('file:///etc/passwd', H)).toBe(false);
    expect(hostErlaubt('kein url', H)).toBe(false);
    expect(p('GET', 'https://example.com/x')).toEqual({ ok: false, grund: 'fremde Domain example.com' });
    expect(p('GET', 'data:image/png;base64,AAA')).toEqual({ ok: true });
  });

  it('lesen ja: Seiten, Dateien, lesende Ajax-Aufrufe', () => {
    expect(p('GET', 'https://moodle.jku.at/course/view.php?id=7')).toEqual({ ok: true });
    expect(p('GET', 'https://moodle.jku.at/pluginfile.php/1/mod_resource/content/2/folien.pdf')).toEqual({ ok: true });
    const ajax = JSON.stringify([
      { index: 0, methodname: 'core_course_get_enrolled_courses_by_timeline_classification', args: {} },
      { index: 1, methodname: 'core_output_load_template_with_dependencies', args: {} },
      { index: 2, methodname: 'core_fetch_notifications', args: {} },
    ]);
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php?sesskey=abc&info=x', ajax)).toEqual({ ok: true });
  });

  it('verändern nein: Abgaben, Formulare, sesskey-Links, Abmelden, schreibende Ajax-Aufrufe', () => {
    expect(p('POST', 'https://moodle.jku.at/mod/assign/view.php', 'action=savesubmission&sesskey=x')).toMatchObject({ ok: false, grund: expect.stringMatching(/Formular/) });
    expect(p('POST', 'https://moodle.jku.at/mod/quiz/startattempt.php', 'cmid=3')).toMatchObject({ ok: false });
    expect(p('POST', 'https://moodle.jku.at/mod/forum/post.php', 'x')).toMatchObject({ ok: false });
    expect(p('GET', 'https://moodle.jku.at/course/togglecompletion.php?id=3&sesskey=abc')).toMatchObject({ ok: false, grund: expect.stringMatching(/sesskey/) });
    expect(p('GET', 'https://moodle.jku.at/login/logout.php?sesskey=abc')).toMatchObject({ ok: false, grund: 'Abmelden ist gesperrt' });
    // verschleierte sesskey-Namen (PHP schneidet Leerzeichen/NUL ab) und Ajax per GET
    for (const q of ['?%20sesskey=abc', '?sesskey%00x=abc', '?%73esskey=abc', '?SESSKEY=abc', '?a=1&+sesskey=b'])
      expect(p('GET', `https://moodle.jku.at/course/togglecompletion.php${q}`), q).toMatchObject({ ok: false, grund: expect.stringMatching(/sesskey/) });
    expect(p('GET', 'https://moodle.jku.at/lib/ajax/service-nologin.php?args=[{"methodname":"core_auth_request_password_reset"}]')).toMatchObject({ ok: false, grund: expect.stringMatching(/GET/) });
    // auch während der Anmeldung keine sesskey-Links
    expect(p('GET', 'https://moodle.jku.at/course/togglecompletion.php?sesskey=abc', null, true)).toMatchObject({ ok: false });
    // http nur lokal
    expect(hostErlaubt('http://moodle.jku.at/', H)).toBe(false);
    expect(hostErlaubt('http://127.0.0.1:3000/', ['127.0.0.1'])).toBe(true);
    expect(p('PUT', 'https://moodle.jku.at/x')).toMatchObject({ ok: false });
    expect(p('DELETE', 'https://moodle.jku.at/x')).toMatchObject({ ok: false });
    const gemischt = JSON.stringify([
      { methodname: 'core_course_get_contents' },
      { methodname: 'core_completion_update_activity_completion_status_manually' },
    ]);
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php', gemischt)).toMatchObject({ ok: false, grund: expect.stringMatching(/update_activity/) });
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php', 'kaputt')).toMatchObject({ ok: false });
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php', '[]')).toMatchObject({ ok: false });
  });

  it('Anmeldung: Formular senden nur während der Anmeldung, auch dann nur auf erlaubten Domains', () => {
    expect(p('POST', 'https://login.jku.at/idp/profile/SAML2/POST/SSO', 'j_username=x', true)).toEqual({ ok: true });
    expect(p('POST', 'https://login.jku.at/idp/profile/SAML2/POST/SSO', 'j_username=x', false)).toMatchObject({ ok: false });
    expect(p('POST', 'https://phish.example/login', 'x', true)).toMatchObject({ ok: false });
    // die Seite nach dem Login lädt noch im Anmeldemodus: ihre Skript-Aufrufe zählen NICHT als Anmeldung
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php', JSON.stringify([{ methodname: 'core_user_update_user_preferences' }]), true, false)).toMatchObject({ ok: false });
    expect(p('POST', 'https://moodle.jku.at/mod/assign/view.php', 'action=submit', true, false)).toMatchObject({ ok: false });
    expect(p('POST', 'https://moodle.jku.at/lib/ajax/service.php', JSON.stringify([{ methodname: 'core_user_update_user_preferences' }]), true, true)).toMatchObject({ ok: false });
  });

  it('Ajax-Namen: lesend vs. schreibend', () => {
    for (const n of ['core_course_get_contents', 'core_calendar_get_action_events_by_timesort', 'mod_assign_get_submission_status', 'core_message_get_unread_conversation_counts', 'mod_resource_view_resource',
      // echte Aufrufe des JKU-Dashboards: Komponente (block_…, core_enrol) ist kein Verb
      'block_recentlyaccesseditems_get_recent_items', 'core_enrol_get_users_courses', 'block_timeline_get_events'])
      expect(nurLesend(n), n).toBe(true);
    for (const n of ['mod_assign_save_submission', 'mod_assign_submit_for_grading', 'core_user_update_user_preferences', 'mod_forum_add_discussion_post', 'mod_quiz_start_attempt', 'core_session_touch', 'mod_assign_get_and_submit', 'core_course_edit_module',
      // Komponente abgetrennt, das Verb zählt weiter
      'block_starredcourses_set_favourite', 'core_block_add_block', 'core_enrol_submit_user_enrolment_form', 'local_x_delete_y', 'core_get_string_and_set',
      // Moodle säubert Namen – Leerzeichen/Sonderzeichen hätten „mark“ versteckt
      'core_message_ma rk_all_notifications_as_read', 'core_message_get_x;mark', ''])
      expect(nurLesend(n), n).toBe(false);
  });
});
