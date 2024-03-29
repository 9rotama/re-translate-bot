import discord

def langs_order_str(langs, origin_lang, separator):
    str = origin_lang + separator + separator.join(langs) + separator + origin_lang
    return str

def create_embed(title, desc, name, icon_url):
    embed = discord.Embed(title=title, description=desc)
    embed.set_author(name=name, icon_url=icon_url)
    return embed

def create_embed_withfooter(title, desc, name, icon_url, footer_text, footer_icon_url):
    embed = discord.Embed(title=title, description=desc)
    embed.set_author(name=name, icon_url=icon_url)
    embed.set_footer(text=footer_text, icon_url=footer_icon_url)
    return embed