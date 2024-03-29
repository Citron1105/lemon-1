import { Client, Command, UserError } from '@structures';
import { CommandInteraction } from 'discord.js';
import { Server } from '@database/models';
import { search } from 'booru';
import { decode } from 'he';
import { BANNED_TAGS_TEXT } from '@constants';
import SearchResults from 'booru/dist/structures/SearchResults';

const SITES = [
    'e621.net',
    'e926.net',
    'hypnohub.net',
    'danbooru.donmai.us',
    'konachan.com',
    'konachan.net',
    'yande.re',
    'gelbooru.com',
    'rule34.xxx',
    'safebooru.org',
    'tbib.org',
    'xbooru.com',
    'rule34.paheal.net',
    'derpibooru.org',
] as const;

export default class extends Command {
    constructor(client: Client) {
        super(client, {
            name: 'booru',
            type: 'CHAT_INPUT',
            description: 'Shows random posts with specified tag on specified booru site',
            cooldown: 5000,
            nsfw: true,
            options: [
                {
                    name: 'site',
                    type: 'STRING',
                    description: 'The site to search on',
                    required: true,
                    choices: SITES.map(k => {
                        return {
                            name: k,
                            value: k,
                        };
                    }),
                },
                {
                    name: 'tag',
                    type: 'STRING',
                    description: 'The tag to search for',
                    required: true,
                },
            ],
        });
    }

    danger = false;
    warning = false;

    async before(interaction: CommandInteraction) {
        try {
            let server = await Server.findOne({ serverID: interaction.guild.id }).exec();
            if (!server) {
                server = await new Server({
                    serverID: interaction.guild.id,
                    settings: { danger: false },
                }).save();
            }
            this.danger = server.settings.danger;
            this.warning = false;
        } catch (err) {
            this.client.logger.error(err);
            throw new Error(`Database error: ${err.message}`);
        }
    }

    async exec(interaction: CommandInteraction) {
        await this.before(interaction);
        const site = interaction.options.get('site').value as typeof SITES[number];
        const tag = interaction.options.get('tag').value as string;
        let res: void | SearchResults = null;
        Promise.race([
            (res = await search(site, tag.replace(/ /g, '_'), { limit: 25, random: true }).catch(
                err => {
                    throw err;
                }
            )), // 25 is more than enough for a page
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
        ]).catch(function (err) {
            if (err.message === 'Timeout') {
                throw new UserError('TIMED_OUT');
            }
        });
        if (
            !res ||
            !res.posts.length ||
            !res.posts.filter(x => this.client.util.isUrl(x.fileUrl)).length
        ) {
            throw new UserError('NO_RESULT', tag);
        }
        const dataPosts = res.posts.filter(x => this.client.util.isUrl(x.fileUrl));
        const display = this.client.embeds.paginator(this.client, {
            startView: 'thumbnail',
            collectorTimeout: 180000,
        });
        dataPosts.forEach(data => {
            const image = data.fileUrl,
                original = data.postView;
            let tags = data.tags;
            tags = tags.map(x => decode(x).replace(/_/g, ' '));
            const prip = this.client.util.hasCommon(tags, BANNED_TAGS_TEXT);
            if (prip) this.warning = true;
            const embed = this.client.embeds
                .default()
                .setDescription(
                    `**Tags** : ${this.client.util.shorten(
                        tags.map((x: string) => `\`${x}\``).join('\u2000'),
                        '\u2000'
                    )}\n\n[Original post](${original})\u2000•\u2000[Click here if image failed to load](${image})`
                );
            if (this.danger || !prip) embed.setImage(image);
            display.addPage('thumbnail', { embed });
        });
        await display.run(interaction, `> **Searching for posts with tag** **\`${tag}\`**`);
        if (!this.danger && this.warning && !this.client.warned.has(interaction.user.id)) {
            this.client.warned.add(interaction.user.id);
            await interaction.followUp(this.client.util.communityGuidelines());
        }
    }
}
